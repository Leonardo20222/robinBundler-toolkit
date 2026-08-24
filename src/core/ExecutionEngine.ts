import { randomUUID } from "node:crypto";
import type { Hash, Hex } from "viem";
import type { AppConfig } from "../config.js";
import type { RpcManager } from "../chain/RpcManager.js";
import type { GasManager } from "../chain/GasManager.js";
import type { SequencerClient } from "../chain/SequencerClient.js";
import { SubmissionMetrics } from "../chain/SubmissionMetrics.js";
import type {
  BundleRepository,
  TransactionRepository,
} from "../database/repositories.js";
import type { WalletManager } from "../wallet/WalletManager.js";
import type { NonceManager } from "../wallet/NonceManager.js";
import type { Bundle, BundleAction, RecordedTransaction, TxLifecycleStatus } from "../types.js";
import type { Simulator } from "../simulation/Simulator.js";
import { mapPool } from "../utils/concurrency.js";

function classifyError(err: unknown): TxLifecycleStatus {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes("nonce")) return "NONCE_ERROR";
  if (msg.includes("insufficient funds") || msg.includes("gas")) return "INSUFFICIENT_GAS";
  if (msg.includes("timeout")) return "TIMEOUT";
  if (msg.includes("revert")) return "REVERTED";
  return "SUBMISSION_FAILED";
}

export class ExecutionEngine {
  readonly metrics = new SubmissionMetrics();

  constructor(
    private readonly config: AppConfig,
    private readonly rpc: RpcManager,
    private readonly gas: GasManager,
    private readonly wallets: WalletManager,
    private readonly nonces: NonceManager,
    private readonly simulator: Simulator,
    private readonly bundles: BundleRepository,
    private readonly txs: TransactionRepository,
    private readonly sequencer?: SequencerClient,
  ) {}

  async executeBundle(bundleId: string): Promise<Bundle> {
    const bundle = await this.require(bundleId);
    if (bundle.status === "CANCELLED") {
      throw new Error("Bundle is cancelled");
    }

    if (bundle.actions.length === 0) {
      throw new Error("No actions");
    }

    this.metrics.reset();

    const report = await this.simulator.simulateBundle(bundle);
    if (!report.ok) {
      bundle.status = "SIMULATION_FAILED";
      await this.bundles.save(bundle);
      throw new Error(
        `Simulation failed:\n${report.issues
          .filter((i) => i.severity === "error")
          .map((i) => `- ${i.message}`)
          .join("\n")}`,
      );
    }

    const fees = await this.gas.getGasPrice();
    const maxFee =
      bundle.gasPlan.maxFeePerGas != null
        ? BigInt(bundle.gasPlan.maxFeePerGas)
        : fees.maxFeePerGas;
    const maxPriority =
      bundle.gasPlan.maxPriorityFeePerGas != null
        ? BigInt(bundle.gasPlan.maxPriorityFeePerGas)
        : fees.maxPriorityFeePerGas;

    await mapPool(bundle.actions, this.config.maxConcurrency, async (action) => {
      await this.executeAction(bundle, action, maxFee, maxPriority);
    });

    return this.finalize(bundleId);
  }

  getLastMetrics() {
    return this.metrics.snapshot();
  }

  private async executeAction(
    bundle: Bundle,
    action: BundleAction,
    maxFeePerGas: bigint,
    maxPriorityFeePerGas: bigint,
  ): Promise<void> {
    if (action.status === "CONFIRMED" || action.status === "CANCELLED") return;

    const record: RecordedTransaction = {
      id: randomUUID(),
      bundleId: bundle.id,
      actionId: action.id,
      wallet: action.walletAddress,
      actionType: action.type,
      amount: action.valueWei,
      status: "CREATED",
      timestamp: new Date().toISOString(),
    };
    await this.txs.append(record);

    if (this.config.mode === "simulation" || bundle.mode === "simulation") {
      action.status = "CONFIRMED";
      action.submittedAt = new Date().toISOString();
      action.confirmedAt = new Date().toISOString();
      action.gasUsed = "180000";
      action.submitLatencyMs = 0;
      action.confirmLatencyMs = 0;
      this.metrics.record({
        actionId: action.id,
        wallet: action.walletAddress,
        submitLatencyMs: 0,
        confirmLatencyMs: 0,
        ok: true,
      });
      await this.txs.update(record.id, {
        status: "CONFIRMED",
        gasUsed: action.gasUsed,
      });
      await this.bundles.save(bundle);
      return;
    }

    if (!action.target || !action.calldata) {
      action.status = "SUBMISSION_FAILED";
      action.error = "Missing target/calldata";
      this.metrics.record({
        actionId: action.id,
        wallet: action.walletAddress,
        submitLatencyMs: 0,
        ok: false,
        error: action.error,
      });
      await this.txs.update(record.id, { status: action.status, error: action.error });
      await this.bundles.save(bundle);
      return;
    }

    let nonce: number | undefined;
    const submitStarted = Date.now();
    try {
      const account = await this.wallets.getAccount(action.walletAddress);
      const walletClient = this.rpc.createWalletClient(account);
      nonce = await this.nonces.reserveNonce(action.walletAddress);
      action.nonce = nonce;
      action.status = "SIGNED";

      const estimated = await this.rpc.getPublicClient().estimateGas({
        account,
        to: action.target,
        data: action.calldata,
        value: BigInt(action.valueWei ?? "0"),
      });
      const gas = this.gas.applyBuffer(estimated, bundle.gasPlan);

      let hash: Hash;
      if (this.config.useSequencer && this.sequencer) {
        const request = await walletClient.prepareTransactionRequest({
          account,
          to: action.target,
          data: action.calldata,
          value: BigInt(action.valueWei ?? "0"),
          nonce,
          gas,
          maxFeePerGas,
          maxPriorityFeePerGas,
          chain: this.rpc.chain,
        });
        const signed = (await walletClient.signTransaction(request)) as Hex;
        hash = await this.sequencer.sendRawTransaction(signed);
      } else {
        hash = (await walletClient.sendTransaction({
          account,
          to: action.target,
          data: action.calldata,
          value: BigInt(action.valueWei ?? "0"),
          nonce,
          gas,
          maxFeePerGas,
          maxPriorityFeePerGas,
          chain: this.rpc.chain,
        })) as Hash;
      }

      const submitLatencyMs = Date.now() - submitStarted;
      action.submitLatencyMs = submitLatencyMs;
      await this.nonces.markNonceSubmitted(action.walletAddress, nonce);
      action.txHash = hash;
      action.status = "SUBMITTED";
      action.submittedAt = new Date().toISOString();
      await this.txs.update(record.id, {
        status: "SUBMITTED",
        txHash: hash,
        nonce,
      });

      const confirmStarted = Date.now();
      const receipt = await this.rpc.getPublicClient().waitForTransactionReceipt({
        hash,
        timeout: 120_000,
      });
      const confirmLatencyMs = Date.now() - confirmStarted;
      action.confirmLatencyMs = confirmLatencyMs;

      if (receipt.status === "reverted") {
        action.status = "REVERTED";
        action.error = "Transaction reverted";
        this.metrics.record({
          actionId: action.id,
          wallet: action.walletAddress,
          submitLatencyMs,
          confirmLatencyMs,
          ok: false,
          error: action.error,
        });
      } else {
        action.status = "CONFIRMED";
        action.confirmedAt = new Date().toISOString();
        action.blockNumber = receipt.blockNumber.toString();
        action.gasUsed = receipt.gasUsed.toString();
        this.metrics.record({
          actionId: action.id,
          wallet: action.walletAddress,
          submitLatencyMs,
          confirmLatencyMs,
          ok: true,
        });
      }
      await this.txs.update(record.id, {
        status: action.status,
        gasUsed: action.gasUsed,
        blockNumber: action.blockNumber,
        error: action.error,
      });
    } catch (err) {
      if (nonce !== undefined) {
        await this.nonces.releaseNonce(action.walletAddress, nonce);
      }
      action.status = classifyError(err);
      action.error = err instanceof Error ? err.message : String(err);
      action.submitLatencyMs = Date.now() - submitStarted;
      this.metrics.record({
        actionId: action.id,
        wallet: action.walletAddress,
        submitLatencyMs: action.submitLatencyMs,
        ok: false,
        error: action.error,
      });
      await this.txs.update(record.id, {
        status: action.status,
        error: action.error,
        nonce,
      });
    }

    await this.bundles.save(bundle);
  }

  async retryFailed(bundleId: string): Promise<Bundle> {
    const bundle = await this.require(bundleId);
    for (const action of bundle.actions) {
      if (
        action.status === "REVERTED" ||
        action.status === "SUBMISSION_FAILED" ||
        action.status === "SIMULATION_FAILED" ||
        action.status === "TIMEOUT" ||
        action.status === "NONCE_ERROR" ||
        action.status === "INSUFFICIENT_GAS"
      ) {
        action.status = "VALIDATED";
        action.error = undefined;
        action.txHash = undefined;
        action.nonce = undefined;
      }
    }
    await this.bundles.save(bundle);
    return this.executeBundle(bundleId);
  }

  async retryPending(bundleId: string): Promise<Bundle> {
    const bundle = await this.require(bundleId);
    for (const action of bundle.actions) {
      if (action.status === "SUBMITTED" || action.status === "SIGNED") {
        action.status = "VALIDATED";
      }
    }
    await this.bundles.save(bundle);
    return this.executeBundle(bundleId);
  }

  async resumeBundle(bundleId: string): Promise<Bundle> {
    const bundle = await this.require(bundleId);
    for (const action of bundle.actions) {
      if (action.status === "CONFIRMED" || action.status === "CANCELLED") continue;
      if (action.status === "SUBMITTED" && action.txHash) {
        try {
          const receipt = await this.rpc
            .getPublicClient()
            .waitForTransactionReceipt({ hash: action.txHash, timeout: 60_000 });
          action.status = receipt.status === "reverted" ? "REVERTED" : "CONFIRMED";
          action.gasUsed = receipt.gasUsed.toString();
          action.blockNumber = receipt.blockNumber.toString();
          action.confirmedAt = new Date().toISOString();
        } catch {
          action.status = "VALIDATED";
          action.txHash = undefined;
        }
      } else {
        action.status = "VALIDATED";
      }
    }
    await this.bundles.save(bundle);
    return this.executeBundle(bundleId);
  }

  async reconcileBundle(bundleId: string): Promise<Bundle> {
    const bundle = await this.require(bundleId);
    for (const wallet of bundle.wallets) {
      await this.nonces.reconcileNonces(wallet);
    }
    for (const action of bundle.actions) {
      if (!action.txHash) continue;
      try {
        const receipt = await this.rpc
          .getPublicClient()
          .getTransactionReceipt({ hash: action.txHash });
        action.status = receipt.status === "reverted" ? "REVERTED" : "CONFIRMED";
        action.gasUsed = receipt.gasUsed.toString();
        action.blockNumber = receipt.blockNumber.toString();
      } catch {
        // leave as-is if not found
      }
    }
    return this.finalize(bundleId);
  }

  private async finalize(bundleId: string): Promise<Bundle> {
    const bundle = await this.require(bundleId);
    const confirmed = bundle.actions.filter((a) => a.status === "CONFIRMED").length;
    const failed = bundle.actions.filter((a) =>
      [
        "REVERTED",
        "SUBMISSION_FAILED",
        "SIMULATION_FAILED",
        "TIMEOUT",
        "NONCE_ERROR",
        "INSUFFICIENT_GAS",
      ].includes(a.status),
    ).length;
    const pending = bundle.actions.length - confirmed - failed;

    if (failed === 0 && pending === 0) bundle.status = "COMPLETED";
    else if (confirmed > 0 && (failed > 0 || pending > 0)) bundle.status = "PARTIAL";
    else if (failed > 0 && confirmed === 0) bundle.status = "SUBMISSION_FAILED";
    else bundle.status = "SUBMITTED";

    bundle.updatedAt = new Date().toISOString();
    await this.bundles.save(bundle);
    return bundle;
  }

  private async require(id: string): Promise<Bundle> {
    const bundle = await this.bundles.get(id);
    if (!bundle) throw new Error(`Bundle not found: ${id}`);
    return bundle;
  }
}

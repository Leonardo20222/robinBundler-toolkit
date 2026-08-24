import { randomUUID } from "node:crypto";
import { parseEther, type Address, type Hex } from "viem";
import type { AppConfig } from "../config.js";
import type { BundleRepository } from "../database/repositories.js";
import type { DexManager } from "../dex/DexManager.js";
import type { TokenManager } from "../token/TokenManager.js";
import type {
  ActionType,
  Bundle,
  BundleAction,
  BundleSummary,
  GasPlan,
} from "../types.js";

function nowIso(): string {
  return new Date().toISOString();
}

export class BundleBuilder {
  constructor(
    private readonly config: AppConfig,
    private readonly repo: BundleRepository,
    private readonly dex: DexManager,
    private readonly tokens: TokenManager,
  ) {}

  async createBundle(name: string, token?: Address): Promise<Bundle> {
    const gasPlan: GasPlan = { gasLimitBufferBps: 1500 };
    const bundle: Bundle = {
      id: randomUUID(),
      name,
      token,
      wallets: [],
      actions: [],
      gasPlan,
      status: "CREATED",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      mode: this.config.mode,
    };
    await this.repo.save(bundle);
    return bundle;
  }

  async addWallet(bundleId: string, wallet: Address): Promise<Bundle> {
    const bundle = await this.require(bundleId);
    if (!bundle.wallets.some((w) => w.toLowerCase() === wallet.toLowerCase())) {
      bundle.wallets.push(wallet);
    }
    bundle.updatedAt = nowIso();
    await this.repo.save(bundle);
    return bundle;
  }

  async removeWallet(bundleId: string, wallet: Address): Promise<Bundle> {
    const bundle = await this.require(bundleId);
    bundle.wallets = bundle.wallets.filter(
      (w) => w.toLowerCase() !== wallet.toLowerCase(),
    );
    bundle.actions = bundle.actions.filter(
      (a) => a.walletAddress.toLowerCase() !== wallet.toLowerCase(),
    );
    bundle.updatedAt = nowIso();
    await this.repo.save(bundle);
    return bundle;
  }

  async addAction(
    bundleId: string,
    input: {
      type: ActionType;
      walletAddress: Address;
      target?: Address;
      valueWei?: string;
      calldata?: Hex;
      params?: Record<string, unknown>;
    },
  ): Promise<Bundle> {
    const bundle = await this.require(bundleId);
    const action: BundleAction = {
      id: randomUUID(),
      type: input.type,
      walletAddress: input.walletAddress,
      target: input.target,
      valueWei: input.valueWei,
      calldata: input.calldata,
      params: input.params,
      status: "CREATED",
    };
    bundle.actions.push(action);
    if (!bundle.wallets.some((w) => w.toLowerCase() === input.walletAddress.toLowerCase())) {
      bundle.wallets.push(input.walletAddress);
    }
    bundle.updatedAt = nowIso();
    await this.repo.save(bundle);
    return bundle;
  }

  /** Convenience: ETH → token buy via configured DEX adapter */
  async addBuyActions(
    bundleId: string,
    plans: { wallet: Address; amountEth: string }[],
    options?: { dex?: string; token?: Address },
  ): Promise<Bundle> {
    const bundle = await this.require(bundleId);
    const token = options?.token ?? bundle.token;
    if (!token) throw new Error("Bundle has no token; pass options.token");
    const adapter = options?.dex ? this.dex.get(options.dex) : this.dex.default();
    const weth = "0x0000000000000000000000000000000000000000" as Address;

    for (const plan of plans) {
      const amountIn = parseEther(plan.amountEth);
      const quote = await adapter.getQuote({
        tokenIn: weth,
        tokenOut: token,
        amountIn,
        slippageBps: this.config.defaultSlippageBps,
      });
      const built = await adapter.buildSwap({
        quote,
        recipient: plan.wallet,
        ethIn: true,
      });
      await this.addAction(bundleId, {
        type: "SWAP",
        walletAddress: plan.wallet,
        target: built.to,
        valueWei: built.value.toString(),
        calldata: built.data,
        params: {
          amountEth: plan.amountEth,
          amountOutMin: quote.amountOutMin.toString(),
          dex: adapter.name,
          token,
        },
      });
    }
    return this.require(bundleId);
  }

  async addTransferAction(
    bundleId: string,
    wallet: Address,
    token: Address,
    to: Address,
    amount: bigint,
  ): Promise<Bundle> {
    return this.addAction(bundleId, {
      type: "TRANSFER",
      walletAddress: wallet,
      target: token,
      valueWei: "0",
      calldata: this.tokens.buildTransferCalldata(to, amount),
      params: { to, amount: amount.toString() },
    });
  }

  async addApproveAction(
    bundleId: string,
    wallet: Address,
    token: Address,
    spender: Address,
    amount: bigint,
  ): Promise<Bundle> {
    return this.addAction(bundleId, {
      type: "APPROVE",
      walletAddress: wallet,
      target: token,
      valueWei: "0",
      calldata: this.tokens.buildApproveCalldata(spender, amount),
      params: { spender, amount: amount.toString() },
    });
  }

  async addContractCall(
    bundleId: string,
    wallet: Address,
    target: Address,
    calldata: Hex,
    valueWei = "0",
  ): Promise<Bundle> {
    return this.addAction(bundleId, {
      type: "CONTRACT_CALL",
      walletAddress: wallet,
      target,
      calldata,
      valueWei,
    });
  }

  async validateBundle(bundleId: string): Promise<{
    ok: boolean;
    errors: string[];
    bundle: Bundle;
  }> {
    const bundle = await this.require(bundleId);
    const errors: string[] = [];
    if (bundle.wallets.length === 0) errors.push("No wallets in bundle");
    if (bundle.actions.length === 0) errors.push("No actions in bundle");
    for (const action of bundle.actions) {
      if (!action.walletAddress) errors.push(`Action ${action.id} missing wallet`);
      if (action.type !== "DEPLOY_TOKEN" && !action.target) {
        errors.push(`Action ${action.id} missing target`);
      }
      if (action.type !== "DEPLOY_TOKEN" && !action.calldata) {
        errors.push(`Action ${action.id} missing calldata`);
      }
      if (!bundle.wallets.some((w) => w.toLowerCase() === action.walletAddress.toLowerCase())) {
        errors.push(`Action ${action.id} wallet not registered on bundle`);
      }
    }
    if (errors.length === 0) {
      for (const action of bundle.actions) {
        if (action.status === "CREATED") action.status = "VALIDATED";
      }
      bundle.status = "VALIDATED";
      bundle.updatedAt = nowIso();
      await this.repo.save(bundle);
    }
    return { ok: errors.length === 0, errors, bundle };
  }

  async cancelBundle(bundleId: string): Promise<Bundle> {
    const bundle = await this.require(bundleId);
    bundle.status = "CANCELLED";
    for (const action of bundle.actions) {
      if (
        action.status === "CREATED" ||
        action.status === "VALIDATED" ||
        action.status === "SIMULATED" ||
        action.status === "SIGNED"
      ) {
        action.status = "CANCELLED";
      }
    }
    bundle.updatedAt = nowIso();
    await this.repo.save(bundle);
    return bundle;
  }

  /** Duplicate a bundle with fresh IDs and reset action statuses */
  async cloneBundle(bundleId: string, name?: string): Promise<Bundle> {
    const source = await this.require(bundleId);
    const clone: Bundle = {
      ...source,
      id: randomUUID(),
      name: name ?? `${source.name}-copy`,
      status: "CREATED",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      mode: this.config.mode,
      actions: source.actions.map((a) => ({
        ...a,
        id: randomUUID(),
        status: "CREATED" as const,
        txHash: undefined,
        nonce: undefined,
        gasUsed: undefined,
        error: undefined,
        blockNumber: undefined,
        submittedAt: undefined,
        confirmedAt: undefined,
        submitLatencyMs: undefined,
        confirmLatencyMs: undefined,
      })),
    };
    await this.repo.save(clone);
    return clone;
  }

  async setGasPlan(
    bundleId: string,
    plan: Partial<GasPlan>,
  ): Promise<Bundle> {
    const bundle = await this.require(bundleId);
    bundle.gasPlan = { ...bundle.gasPlan, ...plan };
    bundle.updatedAt = nowIso();
    await this.repo.save(bundle);
    return bundle;
  }

  /**
   * Bulk-add buys from a list like:
   * [{ "wallet": "0x...", "amountEth": "0.1" }, ...]
   */
  async addBuyPlan(
    bundleId: string,
    plans: { wallet: Address; amountEth: string }[],
    options?: { dex?: string; token?: Address },
  ): Promise<Bundle> {
    return this.addBuyActions(bundleId, plans, options);
  }

  async summarize(bundleId: string): Promise<BundleSummary> {
    const bundle = await this.require(bundleId);
    let successful = 0;
    let failed = 0;
    let pending = 0;
    let gasSpent = 0n;
    for (const action of bundle.actions) {
      if (action.status === "CONFIRMED") successful += 1;
      else if (
        action.status === "REVERTED" ||
        action.status === "SUBMISSION_FAILED" ||
        action.status === "SIMULATION_FAILED" ||
        action.status === "TIMEOUT" ||
        action.status === "NONCE_ERROR" ||
        action.status === "INSUFFICIENT_GAS"
      ) {
        failed += 1;
      } else if (action.status !== "CANCELLED") {
        pending += 1;
      }
      if (action.gasUsed) gasSpent += BigInt(action.gasUsed);
    }
    return {
      id: bundle.id,
      name: bundle.name,
      wallets: bundle.wallets.length,
      successful,
      failed,
      pending,
      gasSpentWei: gasSpent.toString(),
      status: bundle.status,
    };
  }

  list(): Promise<Bundle[]> {
    return this.repo.list();
  }

  get(id: string): Promise<Bundle | undefined> {
    return this.repo.get(id);
  }

  private async require(id: string): Promise<Bundle> {
    const bundle = await this.repo.get(id);
    if (!bundle) throw new Error(`Bundle not found: ${id}`);
    return bundle;
  }
}

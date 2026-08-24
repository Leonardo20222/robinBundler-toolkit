import { formatEther, parseEther, type Address } from "viem";
import type { AppConfig } from "../config.js";
import type { RpcManager } from "../chain/RpcManager.js";
import type { GasManager } from "../chain/GasManager.js";
import type { WalletManager } from "../wallet/WalletManager.js";
import type { Bundle, BundleAction } from "../types.js";
import type { BundleRepository } from "../database/repositories.js";

export type SimulationIssue = {
  actionId: string;
  wallet: Address;
  severity: "error" | "warning";
  message: string;
};

export type SimulationReport = {
  ok: boolean;
  issues: SimulationIssue[];
  estimatedGasEth: string;
  walletsChecked: number;
};

export class Simulator {
  constructor(
    private readonly config: AppConfig,
    private readonly rpc: RpcManager,
    private readonly gas: GasManager,
    private readonly wallets: WalletManager,
    private readonly repo: BundleRepository,
  ) {}

  async simulateBundle(bundle: Bundle): Promise<SimulationReport> {
    const issues: SimulationIssue[] = [];
    const minGas = parseEther(String(this.config.minGasEth));
    const client = this.rpc.getPublicClient();

    for (const wallet of bundle.wallets) {
      const bal = await this.wallets.getBalance(wallet);
      const walletActions = bundle.actions.filter(
        (a) => a.walletAddress.toLowerCase() === wallet.toLowerCase(),
      );
      const valueSum = walletActions.reduce(
        (acc, a) => acc + BigInt(a.valueWei ?? "0"),
        0n,
      );
      if (bal < valueSum + minGas) {
        issues.push({
          actionId: walletActions[0]?.id ?? "wallet",
          wallet,
          severity: this.config.mode === "simulation" ? "warning" : "error",
          message: `Insufficient ETH: have ${formatEther(bal)}, need ~${formatEther(valueSum + minGas)} (value + gas reserve)`,
        });
      }
    }

    for (const action of bundle.actions) {
      await this.simulateAction(bundle, action, issues);
    }

    const gasEstimate = await this.gas.estimateBundleGas(bundle);
    const ok = !issues.some((i) => i.severity === "error");

    if (ok) {
      for (const action of bundle.actions) {
        if (action.status === "VALIDATED" || action.status === "CREATED") {
          action.status = "SIMULATED";
        }
      }
      bundle.status = "SIMULATED";
      bundle.updatedAt = new Date().toISOString();
      await this.repo.save(bundle);
    }

    // silence unused in edge path
    void client;

    return {
      ok,
      issues,
      estimatedGasEth: gasEstimate.estimatedCostEth,
      walletsChecked: bundle.wallets.length,
    };
  }

  private async simulateAction(
    bundle: Bundle,
    action: BundleAction,
    issues: SimulationIssue[],
  ): Promise<void> {
    if (action.type === "DEPLOY_TOKEN") {
      return;
    }
    if (!action.target || !action.calldata) {
      issues.push({
        actionId: action.id,
        wallet: action.walletAddress,
        severity: "error",
        message: "Missing target or calldata",
      });
      action.status = "SIMULATION_FAILED";
      return;
    }

    // Mock DEX targets are not on-chain — treat as paper-success
    if (
      action.target.toLowerCase() ===
      "0x0000000000000000000000000000000000000001"
    ) {
      return;
    }

    try {
      await this.rpc.getPublicClient().call({
        account: action.walletAddress,
        to: action.target,
        data: action.calldata,
        value: BigInt(action.valueWei ?? "0"),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // In simulation mode without live DEX, soft-warn instead of hard-fail for SWAP
      if (this.config.mode === "simulation" && action.type === "SWAP") {
        issues.push({
          actionId: action.id,
          wallet: action.walletAddress,
          severity: "warning",
          message: `Swap eth_call failed (expected if DEX not deployed): ${message}`,
        });
        return;
      }
      issues.push({
        actionId: action.id,
        wallet: action.walletAddress,
        severity: "error",
        message: `Simulation reverted: ${message}`,
      });
      action.status = "SIMULATION_FAILED";
    }

    void bundle;
  }
}

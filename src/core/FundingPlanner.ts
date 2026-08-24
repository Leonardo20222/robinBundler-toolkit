import { formatEther, parseEther, type Address } from "viem";
import type { AppConfig } from "../config.js";
import type { Bundle, FundingPlan } from "../types.js";
import type { WalletManager } from "../wallet/WalletManager.js";
import type { GasManager } from "../chain/GasManager.js";
import type { BundleRepository } from "../database/repositories.js";

export type FundingPlanReport = {
  plan: FundingPlan;
  walletsNeedingFunds: Address[];
  alreadyFunded: Address[];
  totalRequiredWei: string;
  totalRequiredEth: string;
  funderBalanceWei?: string;
  funderBalanceEth?: string;
  funderHasEnough?: boolean;
};

/**
 * Builds and optionally executes per-wallet gas/buy funding for a bundle.
 */
export class FundingPlanner {
  constructor(
    private readonly config: AppConfig,
    private readonly wallets: WalletManager,
    private readonly gas: GasManager,
    private readonly bundles: BundleRepository,
  ) {}

  buildPlan(bundle: Bundle, funder?: Address): FundingPlan {
    const minGasWei = parseEther(String(this.config.minGasEth)).toString();
    const perWallet = new Map<string, bigint>();

    for (const action of bundle.actions) {
      const key = action.walletAddress.toLowerCase();
      const value = BigInt(action.valueWei ?? "0");
      perWallet.set(key, (perWallet.get(key) ?? 0n) + value);
    }

    let maxNeed = parseEther(String(this.config.minGasEth));
    for (const value of perWallet.values()) {
      const need = value + parseEther(String(this.config.minGasEth));
      if (need > maxNeed) maxNeed = need;
    }

    return {
      funderAddress: funder ?? bundle.fundingPlan?.funderAddress,
      perWalletWei: maxNeed.toString(),
      minGasWei,
    };
  }

  async analyze(bundle: Bundle, funder?: Address): Promise<FundingPlanReport> {
    const plan = this.buildPlan(bundle, funder);
    const target = BigInt(plan.perWalletWei);
    const needing: Address[] = [];
    const funded: Address[] = [];

    for (const wallet of bundle.wallets) {
      const bal = await this.wallets.getBalance(wallet);
      if (bal >= target) funded.push(wallet);
      else needing.push(wallet);
    }

    const totalRequired = target * BigInt(needing.length);
    const report: FundingPlanReport = {
      plan,
      walletsNeedingFunds: needing,
      alreadyFunded: funded,
      totalRequiredWei: totalRequired.toString(),
      totalRequiredEth: formatEther(totalRequired),
    };

    if (plan.funderAddress) {
      const funderBal = await this.wallets.getBalance(plan.funderAddress);
      report.funderBalanceWei = funderBal.toString();
      report.funderBalanceEth = formatEther(funderBal);
      report.funderHasEnough = funderBal >= totalRequired;
    }

    return report;
  }

  async attachPlan(bundleId: string, funder?: Address): Promise<Bundle> {
    const bundle = await this.bundles.get(bundleId);
    if (!bundle) throw new Error(`Bundle not found: ${bundleId}`);
    bundle.fundingPlan = this.buildPlan(bundle, funder);
    bundle.updatedAt = new Date().toISOString();
    await this.bundles.save(bundle);
    return bundle;
  }

  async executePlan(bundleId: string): Promise<{
    report: FundingPlanReport;
    results: { to: Address; ok: boolean; error?: string; hash?: string }[];
  }> {
    const bundle = await this.bundles.get(bundleId);
    if (!bundle) throw new Error(`Bundle not found: ${bundleId}`);
    const report = await this.analyze(bundle, bundle.fundingPlan?.funderAddress);
    if (!report.plan.funderAddress) {
      throw new Error("Funding plan has no funderAddress");
    }
    if (report.walletsNeedingFunds.length === 0) {
      return { report, results: [] };
    }

    const perEth = formatEther(BigInt(report.plan.perWalletWei));
    const distributed = await this.gas.distributeGas(
      report.plan.funderAddress,
      report.walletsNeedingFunds,
      perEth,
    );
    return { report, results: distributed.results };
  }
}

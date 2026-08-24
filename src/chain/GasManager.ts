import { formatEther, parseEther } from "viem";
import type { Address } from "viem";
import type { AppConfig } from "../config.js";
import type { RpcManager } from "./RpcManager.js";
import type { Bundle, GasPlan } from "../types.js";
import type { WalletManager } from "../wallet/WalletManager.js";

export class GasManager {
  constructor(
    private readonly config: AppConfig,
    private readonly rpc: RpcManager,
    private readonly wallets: WalletManager,
  ) {}

  async getGasPrice(): Promise<{
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  }> {
    const client = this.rpc.getPublicClient();
    const fees = await client.estimateFeesPerGas();
    return {
      maxFeePerGas: fees.maxFeePerGas ?? 0n,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 0n,
    };
  }

  async estimateWalletGas(to: Address, data: `0x${string}`, value = 0n, from?: Address) {
    return this.rpc.getPublicClient().estimateGas({
      to,
      data,
      value,
      account: from,
    });
  }

  applyBuffer(gasLimit: bigint, plan: GasPlan): bigint {
    const bps = BigInt(plan.gasLimitBufferBps);
    return gasLimit + (gasLimit * bps) / 10000n;
  }

  async estimateBundleGas(bundle: Bundle): Promise<{
    totalGasUnits: bigint;
    estimatedCostWei: bigint;
    estimatedCostEth: string;
  }> {
    const fees = await this.getGasPrice();
    let totalGas = 0n;
    for (const action of bundle.actions) {
      if (!action.target || !action.calldata) {
        totalGas += 65_000n;
        continue;
      }
      try {
        const gas = await this.estimateWalletGas(
          action.target,
          action.calldata,
          BigInt(action.valueWei ?? "0"),
          action.walletAddress,
        );
        totalGas += this.applyBuffer(gas, bundle.gasPlan);
      } catch {
        totalGas += 250_000n;
      }
    }
    const cost = totalGas * fees.maxFeePerGas;
    return {
      totalGasUnits: totalGas,
      estimatedCostWei: cost,
      estimatedCostEth: formatEther(cost),
    };
  }

  async checkGasBalances(addresses: Address[]): Promise<{
    total: number;
    withGas: number;
    belowMin: Address[];
    availableGasWei: bigint;
  }> {
    const min = parseEther(String(this.config.minGasEth));
    let withGas = 0;
    let available = 0n;
    const belowMin: Address[] = [];
    for (const address of addresses) {
      const bal = await this.wallets.getBalance(address);
      available += bal;
      if (bal >= min) withGas += 1;
      else belowMin.push(address);
    }
    return {
      total: addresses.length,
      withGas,
      belowMin,
      availableGasWei: available,
    };
  }

  async distributeGas(
    funder: Address,
    recipients: Address[],
    perWalletEth: string,
  ): Promise<{ results: { to: Address; ok: boolean; error?: string; hash?: string }[] }> {
    const results = [];
    for (const to of recipients) {
      try {
        const res = await this.wallets.fundWallet(funder, to, perWalletEth);
        results.push({ to, ok: true, hash: res.hash });
      } catch (err) {
        results.push({
          to,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { results };
  }

  calculateGasCost(gasUsed: bigint, effectiveGasPrice: bigint): bigint {
    return gasUsed * effectiveGasPrice;
  }
}

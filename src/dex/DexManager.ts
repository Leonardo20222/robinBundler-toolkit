import { parseEther, type Address, type Hex } from "viem";
import type { SwapQuote } from "../types.js";
import type { DexAdapter } from "./DexAdapter.js";

/**
 * Offline / pre-DEX adapter for simulation and paper trading.
 * Uses a fixed virtual price so bundle pipelines can be tested without a live AMM.
 */
export class MockDexAdapter implements DexAdapter {
  readonly name = "mock";

  constructor(private readonly tokensPerEth = 1_000_000n) {}

  async getQuote(args: {
    tokenIn: Address;
    tokenOut: Address;
    amountIn: bigint;
    slippageBps: number;
  }): Promise<SwapQuote> {
    const amountOut = (args.amountIn * this.tokensPerEth) / parseEther("1");
    const amountOutMin =
      amountOut - (amountOut * BigInt(args.slippageBps)) / 10000n;
    return {
      amountIn: args.amountIn,
      amountOut,
      amountOutMin,
      path: [args.tokenIn, args.tokenOut],
      router: "0x0000000000000000000000000000000000000001",
      deadline: Math.floor(Date.now() / 1000) + 600,
    };
  }

  async buildSwap(args: {
    quote: SwapQuote;
    recipient: Address;
    ethIn?: boolean;
  }): Promise<{ to: Address; data: Hex; value: bigint }> {
    // Synthetic calldata: encode amount + recipient for dry-run inspection
    const data = (`0x${args.quote.amountIn.toString(16).padStart(64, "0")}${args.recipient
      .slice(2)
      .toLowerCase()}`) as Hex;
    return {
      to: args.quote.router,
      data,
      value: args.ethIn === false ? 0n : args.quote.amountIn,
    };
  }

  async estimateSwap(): Promise<bigint> {
    return 180_000n;
  }

  async getTokenPrice(): Promise<bigint> {
    return this.tokensPerEth;
  }
}

export class DexManager {
  private adapters = new Map<string, DexAdapter>();

  register(adapter: DexAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  get(name: string): DexAdapter {
    const adapter = this.adapters.get(name);
    if (!adapter) throw new Error(`DEX adapter not found: ${name}`);
    return adapter;
  }

  list(): string[] {
    return [...this.adapters.keys()];
  }

  default(): DexAdapter {
    const first = this.adapters.values().next().value;
    if (!first) throw new Error("No DEX adapters registered");
    return first;
  }
}

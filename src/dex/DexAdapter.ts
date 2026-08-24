import type { Address, Hex } from "viem";
import type { SwapQuote } from "../types.js";

export interface DexAdapter {
  readonly name: string;
  getQuote(args: {
    tokenIn: Address;
    tokenOut: Address;
    amountIn: bigint;
    slippageBps: number;
  }): Promise<SwapQuote>;
  buildSwap(args: {
    quote: SwapQuote;
    recipient: Address;
    ethIn?: boolean;
  }): Promise<{ to: Address; data: Hex; value: bigint }>;
  estimateSwap(args: {
    tokenIn: Address;
    tokenOut: Address;
    amountIn: bigint;
    from: Address;
  }): Promise<bigint>;
  getPool?(tokenA: Address, tokenB: Address): Promise<Address | null>;
  getTokenPrice?(token: Address, quoteToken: Address): Promise<bigint>;
}

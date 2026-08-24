import {
  encodeFunctionData,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import type { RpcManager } from "../chain/RpcManager.js";
import type { SwapQuote } from "../types.js";
import type { DexAdapter } from "./DexAdapter.js";

const routerAbi = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] calldata path) view returns (uint256[] memory amounts)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) payable returns (uint256[] memory amounts)",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) returns (uint256[] memory amounts)",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) returns (uint256[] memory amounts)",
  "function WETH() view returns (address)",
]);

/**
 * Uniswap V2–style router adapter.
 * Set ROUTER_ADDRESS / WETH_ADDRESS via constructor once a DEX is live on Robinhood Chain.
 */
export class UniswapV2Adapter implements DexAdapter {
  readonly name = "uniswap-v2";

  constructor(
    private readonly rpc: RpcManager,
    private readonly router: Address,
    private readonly weth: Address,
  ) {}

  async getQuote(args: {
    tokenIn: Address;
    tokenOut: Address;
    amountIn: bigint;
    slippageBps: number;
  }): Promise<SwapQuote> {
    const path =
      args.tokenIn.toLowerCase() === this.weth.toLowerCase() ||
      args.tokenOut.toLowerCase() === this.weth.toLowerCase()
        ? [args.tokenIn, args.tokenOut]
        : [args.tokenIn, this.weth, args.tokenOut];

    const client = this.rpc.getPublicClient();
    const amounts = await client.readContract({
      address: this.router,
      abi: routerAbi,
      functionName: "getAmountsOut",
      args: [args.amountIn, path],
    });
    const amountOut = amounts[amounts.length - 1]!;
    const amountOutMin =
      amountOut - (amountOut * BigInt(args.slippageBps)) / 10000n;
    return {
      amountIn: args.amountIn,
      amountOut,
      amountOutMin,
      path,
      router: this.router,
      deadline: Math.floor(Date.now() / 1000) + 600,
    };
  }

  async buildSwap(args: {
    quote: SwapQuote;
    recipient: Address;
    ethIn?: boolean;
  }): Promise<{ to: Address; data: Hex; value: bigint }> {
    const { quote, recipient } = args;
    const ethIn =
      args.ethIn ??
      quote.path[0]!.toLowerCase() === this.weth.toLowerCase();
    const ethOut =
      quote.path[quote.path.length - 1]!.toLowerCase() === this.weth.toLowerCase();

    let data: Hex;
    let value = 0n;

    if (ethIn) {
      data = encodeFunctionData({
        abi: routerAbi,
        functionName: "swapExactETHForTokens",
        args: [quote.amountOutMin, quote.path, recipient, BigInt(quote.deadline)],
      });
      value = quote.amountIn;
    } else if (ethOut) {
      data = encodeFunctionData({
        abi: routerAbi,
        functionName: "swapExactTokensForETH",
        args: [
          quote.amountIn,
          quote.amountOutMin,
          quote.path,
          recipient,
          BigInt(quote.deadline),
        ],
      });
    } else {
      data = encodeFunctionData({
        abi: routerAbi,
        functionName: "swapExactTokensForTokens",
        args: [
          quote.amountIn,
          quote.amountOutMin,
          quote.path,
          recipient,
          BigInt(quote.deadline),
        ],
      });
    }

    return { to: this.router, data, value };
  }

  async estimateSwap(args: {
    tokenIn: Address;
    tokenOut: Address;
    amountIn: bigint;
    from: Address;
  }): Promise<bigint> {
    const quote = await this.getQuote({
      ...args,
      slippageBps: 100,
    });
    const built = await this.buildSwap({ quote, recipient: args.from });
    return this.rpc.getPublicClient().estimateGas({
      account: args.from,
      to: built.to,
      data: built.data,
      value: built.value,
    });
  }

  async getTokenPrice(token: Address, quoteToken: Address): Promise<bigint> {
    const one = 10n ** 18n;
    const quote = await this.getQuote({
      tokenIn: token,
      tokenOut: quoteToken,
      amountIn: one,
      slippageBps: 0,
    });
    return quote.amountOut;
  }
}

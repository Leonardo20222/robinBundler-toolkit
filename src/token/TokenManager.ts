import {
  encodeDeployData,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";
import type { RpcManager } from "../chain/RpcManager.js";
import type { WalletManager } from "../wallet/WalletManager.js";
import type { NonceManager } from "../wallet/NonceManager.js";
import type { AppConfig } from "../config.js";
import { simpleErc20Artifact } from "./SimpleERC20.js";

export class TokenManager {
  constructor(
    private readonly config: AppConfig,
    private readonly rpc: RpcManager,
    private readonly wallets: WalletManager,
    private readonly nonces: NonceManager,
  ) {}

  async deployToken(args: {
    from: Address;
    name: string;
    symbol: string;
    decimals?: number;
    initialSupply: bigint;
  }): Promise<{ address?: Address; hash?: Hex; simulated: boolean; bytecode: Hex }> {
    const account = await this.wallets.getAccount(args.from);
    const bytecode = encodeDeployData({
      abi: simpleErc20Artifact.abi,
      bytecode: simpleErc20Artifact.bytecode,
      args: [args.name, args.symbol, args.decimals ?? 18, args.initialSupply, args.from],
    });

    if (this.config.mode === "simulation") {
      // Placeholder bytecode is not executable on-chain; validate inputs only.
      if (!args.name || !args.symbol || args.initialSupply < 0n) {
        throw new Error("Invalid token deploy parameters");
      }
      return { simulated: true, bytecode };
    }

    const walletClient = this.rpc.createWalletClient(account);
    const nonce = await this.nonces.reserveNonce(args.from);
    try {
      const hash = await walletClient.deployContract({
        abi: simpleErc20Artifact.abi,
        bytecode: simpleErc20Artifact.bytecode,
        args: [args.name, args.symbol, args.decimals ?? 18, args.initialSupply, args.from],
        account,
        chain: this.rpc.chain,
        nonce,
      });
      await this.nonces.markNonceSubmitted(args.from, nonce);
      const receipt = await this.rpc.getPublicClient().waitForTransactionReceipt({ hash });
      return {
        address: receipt.contractAddress ?? undefined,
        hash,
        simulated: false,
        bytecode,
      };
    } catch (err) {
      await this.nonces.releaseNonce(args.from, nonce);
      throw err;
    }
  }

  async getTokenMetadata(token: Address): Promise<{
    name: string;
    symbol: string;
    decimals: number;
    totalSupply: bigint;
  }> {
    const client = this.rpc.getPublicClient();
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      client.readContract({
        address: token,
        abi: simpleErc20Artifact.abi,
        functionName: "name",
      }),
      client.readContract({
        address: token,
        abi: simpleErc20Artifact.abi,
        functionName: "symbol",
      }),
      client.readContract({
        address: token,
        abi: simpleErc20Artifact.abi,
        functionName: "decimals",
      }),
      client.readContract({
        address: token,
        abi: simpleErc20Artifact.abi,
        functionName: "totalSupply",
      }),
    ]);
    return { name, symbol, decimals, totalSupply };
  }

  buildTransferCalldata(to: Address, amount: bigint): Hex {
    return encodeFunctionData({
      abi: simpleErc20Artifact.abi,
      functionName: "transfer",
      args: [to, amount],
    });
  }

  buildApproveCalldata(spender: Address, amount: bigint): Hex {
    return encodeFunctionData({
      abi: simpleErc20Artifact.abi,
      functionName: "approve",
      args: [spender, amount],
    });
  }

  async transfer(from: Address, token: Address, to: Address, amount: bigint) {
    return this.sendTokenTx(from, token, this.buildTransferCalldata(to, amount));
  }

  async approve(from: Address, token: Address, spender: Address, amount: bigint) {
    return this.sendTokenTx(from, token, this.buildApproveCalldata(spender, amount));
  }

  async mint(from: Address, token: Address, to: Address, amount: bigint) {
    const data = encodeFunctionData({
      abi: simpleErc20Artifact.abi,
      functionName: "mint",
      args: [to, amount],
    });
    return this.sendTokenTx(from, token, data);
  }

  async burn(from: Address, token: Address, amount: bigint) {
    const data = encodeFunctionData({
      abi: simpleErc20Artifact.abi,
      functionName: "burn",
      args: [amount],
    });
    return this.sendTokenTx(from, token, data);
  }

  private async sendTokenTx(from: Address, token: Address, data: Hex) {
    const account = await this.wallets.getAccount(from);
    if (this.config.mode === "simulation") {
      await this.rpc.getPublicClient().estimateGas({
        account,
        to: token,
        data,
      });
      return { simulated: true as const };
    }
    const walletClient = this.rpc.createWalletClient(account);
    const nonce = await this.nonces.reserveNonce(from);
    try {
      const hash = await walletClient.sendTransaction({
        account,
        to: token,
        data,
        chain: this.rpc.chain,
        nonce,
      });
      await this.nonces.markNonceSubmitted(from, nonce);
      return { hash, simulated: false as const };
    } catch (err) {
      await this.nonces.releaseNonce(from, nonce);
      throw err;
    }
  }
}

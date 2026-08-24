import {
  formatEther,
  parseEther,
  type Address,
  type Hex,
  type PrivateKeyAccount,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { AppConfig } from "../config.js";
import type { RpcManager } from "../chain/RpcManager.js";
import type { WalletRepository } from "../database/repositories.js";
import type { ManagedWallet, WalletStatus } from "../types.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import type { NonceManager } from "./NonceManager.js";

export class WalletManager {
  constructor(
    private readonly config: AppConfig,
    private readonly repo: WalletRepository,
    private readonly rpc: RpcManager,
    private readonly nonces: NonceManager,
  ) {}

  async createWallet(label?: string): Promise<ManagedWallet> {
    const privateKey = generatePrivateKey();
    return this.persistKey(privateKey, label ?? `wallet-${Date.now()}`);
  }

  async importWallet(privateKey: Hex, label?: string): Promise<ManagedWallet> {
    const normalized = (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as Hex;
    privateKeyToAccount(normalized);
    return this.persistKey(normalized, label ?? `imported-${Date.now()}`);
  }

  private async persistKey(privateKey: Hex, label: string): Promise<ManagedWallet> {
    const account = privateKeyToAccount(privateKey);
    const encrypted = encryptSecret(privateKey, this.config.walletPassphrase);
    const wallet: ManagedWallet = {
      address: account.address,
      label,
      createdAt: new Date().toISOString(),
      encryptedPrivateKey: encrypted.ciphertext,
      iv: encrypted.iv,
      salt: encrypted.salt,
    };
    await this.repo.upsert(wallet);
    return wallet;
  }

  async listWallets(): Promise<ManagedWallet[]> {
    return this.repo.list();
  }

  async getAccount(address: Address): Promise<PrivateKeyAccount> {
    const wallet = await this.repo.get(address);
    if (!wallet) throw new Error(`Wallet not found: ${address}`);
    const pk = decryptSecret(
      wallet.encryptedPrivateKey,
      wallet.iv,
      wallet.salt,
      this.config.walletPassphrase,
    ) as Hex;
    return privateKeyToAccount(pk);
  }

  async getBalance(address: Address): Promise<bigint> {
    return this.rpc.getPublicClient().getBalance({ address });
  }

  async getTokenBalance(address: Address, token: Address): Promise<bigint> {
    const client = this.rpc.getPublicClient();
    return client.readContract({
      address: token,
      abi: [
        {
          type: "function",
          name: "balanceOf",
          stateMutability: "view",
          inputs: [{ name: "account", type: "address" }],
          outputs: [{ type: "uint256" }],
        },
      ] as const,
      functionName: "balanceOf",
      args: [address],
    });
  }

  async getWalletStatus(address: Address): Promise<WalletStatus> {
    const wallet = await this.repo.get(address);
    if (!wallet) throw new Error(`Wallet not found: ${address}`);
    const ethBalanceWei = await this.getBalance(address);
    const nonce = await this.nonces.reconcileNonces(address);
    const minGas = parseEther(String(this.config.minGasEth));
    return {
      address,
      label: wallet.label,
      ethBalanceWei: ethBalanceWei.toString(),
      ethBalanceEth: formatEther(ethBalanceWei),
      hasMinGas: ethBalanceWei >= minGas,
      confirmedNonce: nonce.confirmed,
      pendingNonce: nonce.pending,
    };
  }

  async fundWallet(
    from: Address,
    to: Address,
    amountEth: string,
  ): Promise<{ hash?: Hex; simulated: boolean }> {
    const account = await this.getAccount(from);
    const value = parseEther(amountEth);
    const walletClient = this.rpc.createWalletClient(account);
    const request = {
      account,
      to,
      value,
      chain: this.rpc.chain,
    };

    if (this.config.mode === "simulation") {
      await this.rpc.getPublicClient().estimateGas(request);
      return { simulated: true };
    }

    const nonce = await this.nonces.reserveNonce(from);
    try {
      const hash = await walletClient.sendTransaction({ ...request, nonce });
      await this.nonces.markNonceSubmitted(from, nonce);
      return { hash, simulated: false };
    } catch (err) {
      await this.nonces.releaseNonce(from, nonce);
      throw err;
    }
  }

  async consolidateWallet(
    from: Address,
    to: Address,
    leaveGasEth?: string,
  ): Promise<{ hash?: Hex; amountWei: string; simulated: boolean }> {
    const leave = parseEther(leaveGasEth ?? String(this.config.minGasEth));
    const balance = await this.getBalance(from);
    if (balance <= leave) {
      throw new Error(`Insufficient balance to consolidate from ${from}`);
    }
    const amount = balance - leave;
    const account = await this.getAccount(from);
    const walletClient = this.rpc.createWalletClient(account);
    const request = {
      account,
      to,
      value: amount,
      chain: this.rpc.chain,
    };

    if (this.config.mode === "simulation") {
      await this.rpc.getPublicClient().estimateGas(request);
      return { amountWei: amount.toString(), simulated: true };
    }

    const nonce = await this.nonces.reserveNonce(from);
    try {
      const hash = await walletClient.sendTransaction({ ...request, nonce });
      await this.nonces.markNonceSubmitted(from, nonce);
      return { hash, amountWei: amount.toString(), simulated: false };
    } catch (err) {
      await this.nonces.releaseNonce(from, nonce);
      throw err;
    }
  }

  async removeWallet(address: Address): Promise<boolean> {
    return this.repo.remove(address);
  }
}

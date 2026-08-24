import type { Address } from "viem";
import type { NonceState } from "../types.js";
import type { RpcManager } from "../chain/RpcManager.js";

/**
 * Prevents concurrent workers from colliding on the same nonce.
 * Tracks confirmed / pending / reserved nonces per wallet.
 */
export class NonceManager {
  private states = new Map<string, NonceState>();
  private locks = new Map<string, Promise<void>>();

  constructor(private readonly rpc: RpcManager) {}

  private key(address: Address): string {
    return address.toLowerCase();
  }

  private async withLock<T>(address: Address, fn: () => Promise<T>): Promise<T> {
    const k = this.key(address);
    const prev = this.locks.get(k) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(
      k,
      prev.then(() => gate),
    );
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async reconcileNonces(address: Address): Promise<NonceState> {
    return this.withLock(address, async () => {
      const client = this.rpc.getPublicClient();
      const confirmed = await client.getTransactionCount({
        address,
        blockTag: "latest",
      });
      const pending = await client.getTransactionCount({
        address,
        blockTag: "pending",
      });
      const state: NonceState = {
        address,
        confirmed,
        pending,
        reserved: [],
      };
      this.states.set(this.key(address), state);
      return state;
    });
  }

  async getPendingNonce(address: Address): Promise<number> {
    const state = await this.ensure(address);
    return state.pending;
  }

  async reserveNonce(address: Address): Promise<number> {
    return this.withLock(address, async () => {
      const state = await this.ensureUnlocked(address);
      const nonce = state.reserved.length
        ? Math.max(...state.reserved) + 1
        : Math.max(state.pending, state.confirmed);
      state.reserved.push(nonce);
      state.pending = Math.max(state.pending, nonce + 1);
      this.states.set(this.key(address), state);
      return nonce;
    });
  }

  async releaseNonce(address: Address, nonce: number): Promise<void> {
    return this.withLock(address, async () => {
      const state = await this.ensureUnlocked(address);
      state.reserved = state.reserved.filter((n) => n !== nonce);
      this.states.set(this.key(address), state);
    });
  }

  async markNonceSubmitted(address: Address, nonce: number): Promise<void> {
    return this.withLock(address, async () => {
      const state = await this.ensureUnlocked(address);
      state.reserved = state.reserved.filter((n) => n !== nonce);
      state.pending = Math.max(state.pending, nonce + 1);
      this.states.set(this.key(address), state);
    });
  }

  getState(address: Address): NonceState | undefined {
    return this.states.get(this.key(address));
  }

  private async ensure(address: Address): Promise<NonceState> {
    return this.withLock(address, () => this.ensureUnlocked(address));
  }

  private async ensureUnlocked(address: Address): Promise<NonceState> {
    const existing = this.states.get(this.key(address));
    if (existing) return existing;
    const client = this.rpc.getPublicClient();
    const confirmed = await client.getTransactionCount({
      address,
      blockTag: "latest",
    });
    const pending = await client.getTransactionCount({
      address,
      blockTag: "pending",
    });
    const state: NonceState = { address, confirmed, pending, reserved: [] };
    this.states.set(this.key(address), state);
    return state;
  }
}

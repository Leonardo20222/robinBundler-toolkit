import {
  createPublicClient,
  parseAbiItem,
  type Address,
  type Hash,
  type Log,
} from "viem";
import type { RpcManager } from "./RpcManager.js";

export type MonitoredEvent = {
  name: "Transfer" | "Approval" | "Swap" | "Unknown";
  address: Address;
  txHash: Hash;
  blockNumber: bigint;
  args: Record<string, unknown>;
  raw: Log;
};

type Listener = (event: MonitoredEvent) => void;

/**
 * Optional log subscription layer. Prefer dedicated indexers in production;
 * this helps correlate bundle txs with Transfer/Approval/Swap events.
 */
export class EventMonitor {
  private unwatchers: Array<() => void> = [];
  private listeners = new Set<Listener>();

  constructor(private readonly rpc: RpcManager) {}

  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: MonitoredEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  async start(addresses: Address[]): Promise<void> {
    await this.stop();
    const ws = this.rpc.getWsTransport();
    const client = ws
      ? createPublicClient({ chain: this.rpc.chain, transport: ws })
      : this.rpc.getPublicClient();

    const transferEvent = parseAbiItem(
      "event Transfer(address indexed from, address indexed to, uint256 value)",
    );
    const approvalEvent = parseAbiItem(
      "event Approval(address indexed owner, address indexed spender, uint256 value)",
    );
    const swapEvent = parseAbiItem(
      "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
    );

    for (const event of [transferEvent, approvalEvent, swapEvent] as const) {
      const unwatch = client.watchEvent({
        address: addresses.length ? addresses : undefined,
        event,
        onLogs: (logs) => {
          for (const log of logs) {
            const name =
              event.name === "Transfer"
                ? "Transfer"
                : event.name === "Approval"
                  ? "Approval"
                  : event.name === "Swap"
                    ? "Swap"
                    : "Unknown";
            this.emit({
              name,
              address: log.address,
              txHash: log.transactionHash!,
              blockNumber: log.blockNumber!,
              args: (log as { args?: Record<string, unknown> }).args ?? {},
              raw: log,
            });
          }
        },
      });
      this.unwatchers.push(unwatch);
    }
  }

  async stop(): Promise<void> {
    for (const unwatch of this.unwatchers) unwatch();
    this.unwatchers = [];
  }
}

import {
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  webSocket,
  type Account,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import {
  alchemyHttpUrl,
  alchemyWsUrl,
  getChain,
  sequencerUrl,
  type NetworkName,
} from "./networks.js";
import type { AppConfig } from "../config.js";

export type RpcEndpoint = {
  name: string;
  url: string;
  kind: "http" | "ws";
};

export class RpcManager {
  readonly chain: Chain;
  readonly network: NetworkName;
  private endpoints: RpcEndpoint[] = [];
  private publicClient: PublicClient | null = null;
  private primaryIndex = 0;

  constructor(private readonly config: AppConfig) {
    this.network = config.network;
    this.chain = getChain(config.network);
    this.endpoints = this.buildEndpoints();
  }

  private buildEndpoints(): RpcEndpoint[] {
    const list: RpcEndpoint[] = [];
    if (this.config.rpcUrl) {
      list.push({ name: "primary", url: this.config.rpcUrl, kind: "http" });
    } else if (this.config.alchemyApiKey) {
      list.push({
        name: "alchemy",
        url: alchemyHttpUrl(this.network, this.config.alchemyApiKey),
        kind: "http",
      });
    }
    if (this.config.rpcUrlSecondary) {
      list.push({ name: "secondary", url: this.config.rpcUrlSecondary, kind: "http" });
    }
    list.push({
      name: "public",
      url: this.chain.rpcUrls.default.http[0]!,
      kind: "http",
    });
    list.push({
      name: "sequencer",
      url: sequencerUrl(this.network),
      kind: "http",
    });
    return list;
  }

  getHttpUrls(): string[] {
    return this.endpoints.filter((e) => e.kind === "http").map((e) => e.url);
  }

  getPublicClient(): PublicClient {
    if (this.publicClient) return this.publicClient;
    const urls = this.getHttpUrls();
    const transport =
      urls.length === 1
        ? http(urls[0])
        : fallback(urls.map((url) => http(url)));
    this.publicClient = createPublicClient({
      chain: this.chain,
      transport,
    });
    return this.publicClient;
  }

  createWalletClient(account: Account): WalletClient {
    const urls = this.getHttpUrls();
    const transport =
      urls.length === 1
        ? http(urls[0])
        : fallback(urls.map((url) => http(url)));
    return createWalletClient({
      account,
      chain: this.chain,
      transport,
    });
  }

  getWsTransport(): Transport | null {
    const ws =
      this.config.wsUrl ||
      (this.config.alchemyApiKey
        ? alchemyWsUrl(this.network, this.config.alchemyApiKey)
        : this.chain.rpcUrls.default.webSocket?.[0]);
    if (!ws) return null;
    return webSocket(ws);
  }

  async healthCheck(): Promise<{ name: string; ok: boolean; latencyMs: number; error?: string }[]> {
    const results = [];
    for (const endpoint of this.endpoints.filter((e) => e.kind === "http")) {
      const started = Date.now();
      try {
        const client = createPublicClient({
          chain: this.chain,
          transport: http(endpoint.url, { timeout: 8_000 }),
        });
        await client.getBlockNumber();
        results.push({
          name: endpoint.name,
          ok: true,
          latencyMs: Date.now() - started,
        });
      } catch (err) {
        results.push({
          name: endpoint.name,
          ok: false,
          latencyMs: Date.now() - started,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return results;
  }

  async getBestEndpoint(): Promise<RpcEndpoint | null> {
    const health = await this.healthCheck();
    const ok = health
      .filter((h) => h.ok)
      .sort((a, b) => a.latencyMs - b.latencyMs);
    if (ok.length === 0) return null;
    return this.endpoints.find((e) => e.name === ok[0]!.name) ?? null;
  }

  async failover(): Promise<void> {
    const best = await this.getBestEndpoint();
    if (!best) throw new Error("No healthy RPC endpoints available");
    this.primaryIndex = this.endpoints.findIndex((e) => e.name === best.name);
    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(best.url),
    });
  }

  async latencyCheck(): Promise<number> {
    const client = this.getPublicClient();
    const started = Date.now();
    await client.getBlockNumber();
    return Date.now() - started;
  }

  getPrimaryName(): string {
    return this.endpoints[this.primaryIndex]?.name ?? "unknown";
  }

  /** Low-level eth_call helper for custom simulation */
  async call(args: { to: Hex; data: Hex; account?: Hex; value?: bigint }) {
    return this.getPublicClient().call({
      to: args.to,
      data: args.data,
      account: args.account,
      value: args.value,
    });
  }
}

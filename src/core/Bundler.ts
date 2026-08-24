import type { Address } from "viem";
import { loadConfig, type AppConfig } from "../config.js";
import { RpcManager } from "../chain/RpcManager.js";
import { GasManager } from "../chain/GasManager.js";
import { EventMonitor } from "../chain/EventMonitor.js";
import { SequencerClient } from "../chain/SequencerClient.js";
import {
  BundleRepository,
  TransactionRepository,
  WalletRepository,
} from "../database/repositories.js";
import { DexManager, MockDexAdapter } from "../dex/DexManager.js";
import { UniswapV2Adapter } from "../dex/UniswapV2Adapter.js";
import { TokenManager } from "../token/TokenManager.js";
import { NonceManager } from "../wallet/NonceManager.js";
import { WalletManager } from "../wallet/WalletManager.js";
import { BundleBuilder } from "./BundleBuilder.js";
import { ExecutionEngine } from "./ExecutionEngine.js";
import { FundingPlanner } from "./FundingPlanner.js";
import { Simulator } from "../simulation/Simulator.js";
import { renderBundleDashboard } from "../utils/dashboard.js";

export class Bundler {
  readonly config: AppConfig;
  readonly rpc: RpcManager;
  readonly wallets: WalletManager;
  readonly nonces: NonceManager;
  readonly gas: GasManager;
  readonly tokens: TokenManager;
  readonly dex: DexManager;
  readonly bundles: BundleBuilder;
  readonly executor: ExecutionEngine;
  readonly simulator: Simulator;
  readonly events: EventMonitor;
  readonly funding: FundingPlanner;
  readonly sequencer: SequencerClient;
  readonly txRepo: TransactionRepository;
  private readonly bundleRepo: BundleRepository;

  private constructor(config: AppConfig) {
    this.config = config;
    this.rpc = new RpcManager(config);
    this.nonces = new NonceManager(this.rpc);
    this.sequencer = new SequencerClient(
      config.network,
      config.sequencerUrl || undefined,
    );

    const walletRepo = new WalletRepository(config.dataDir);
    this.bundleRepo = new BundleRepository(config.dataDir);
    this.txRepo = new TransactionRepository(config.dataDir);

    this.wallets = new WalletManager(config, walletRepo, this.rpc, this.nonces);
    this.gas = new GasManager(config, this.rpc, this.wallets);
    this.tokens = new TokenManager(config, this.rpc, this.wallets, this.nonces);

    this.dex = new DexManager();
    this.dex.register(new MockDexAdapter());

    const router = process.env.DEX_ROUTER_ADDRESS as Address | undefined;
    const weth = process.env.WETH_ADDRESS as Address | undefined;
    if (router && weth) {
      this.dex.register(new UniswapV2Adapter(this.rpc, router, weth));
    }

    this.bundles = new BundleBuilder(config, this.bundleRepo, this.dex, this.tokens);
    this.simulator = new Simulator(
      config,
      this.rpc,
      this.gas,
      this.wallets,
      this.bundleRepo,
    );
    this.executor = new ExecutionEngine(
      config,
      this.rpc,
      this.gas,
      this.wallets,
      this.nonces,
      this.simulator,
      this.bundleRepo,
      this.txRepo,
      this.sequencer,
    );
    this.funding = new FundingPlanner(
      config,
      this.wallets,
      this.gas,
      this.bundleRepo,
    );
    this.events = new EventMonitor(this.rpc);
  }

  static create(overrides: Partial<AppConfig> = {}): Bundler {
    return new Bundler(loadConfig(overrides));
  }

  async health(): Promise<{
    network: string;
    chainId: number;
    mode: string;
    useSequencer: boolean;
    primaryRpc: string;
    endpoints: Awaited<ReturnType<RpcManager["healthCheck"]>>;
    sequencer: Awaited<ReturnType<SequencerClient["ping"]>>;
  }> {
    const [endpoints, sequencer] = await Promise.all([
      this.rpc.healthCheck(),
      this.sequencer.ping(),
    ]);
    return {
      network: this.config.network,
      chainId: this.rpc.chain.id,
      mode: this.config.mode,
      useSequencer: this.config.useSequencer,
      primaryRpc: this.rpc.getPrimaryName(),
      endpoints,
      sequencer,
    };
  }

  async dashboard(bundleId: string): Promise<string> {
    const bundle = await this.bundles.get(bundleId);
    if (!bundle) throw new Error(`Bundle not found: ${bundleId}`);
    const summary = await this.bundles.summarize(bundleId);
    let estimatedGasEth: string | undefined;
    try {
      const est = await this.gas.estimateBundleGas(bundle);
      estimatedGasEth = est.estimatedCostEth;
    } catch {
      estimatedGasEth = undefined;
    }
    return renderBundleDashboard(bundle, summary, { estimatedGasEth });
  }
}

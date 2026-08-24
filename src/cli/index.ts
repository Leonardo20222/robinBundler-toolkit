#!/usr/bin/env node
import { Command } from "commander";
import { formatEther, parseEther, type Address, type Hex } from "viem";
import { Bundler } from "../core/Bundler.js";

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const program = new Command();
  program
    .name("bundler")
    .description("Robinhood Chain multi-wallet token bundler")
    .option("--mode <mode>", "simulation | live")
    .option("--network <network>", "mainnet | testnet");

  const getBundler = () => {
    const opts = program.opts<{ mode?: string; network?: string }>();
    return Bundler.create({
      ...(opts.mode === "live" || opts.mode === "simulation"
        ? { mode: opts.mode }
        : {}),
      ...(opts.network === "mainnet" || opts.network === "testnet"
        ? { network: opts.network }
        : {}),
    });
  };

  program
    .command("health")
    .description("Check RPC endpoints and network config")
    .action(async () => {
      const b = getBundler();
      printJson(await b.health());
    });

  const wallet = program.command("wallet").description("Wallet management");

  wallet
    .command("create")
    .argument("[label]", "wallet label")
    .option("-n, --count <n>", "number of wallets", "1")
    .action(async (label: string | undefined, opts: { count: string }) => {
      const b = getBundler();
      const count = Number(opts.count);
      const created = [];
      for (let i = 0; i < count; i++) {
        const w = await b.wallets.createWallet(
          label ? `${label}-${i + 1}` : undefined,
        );
        created.push({ address: w.address, label: w.label });
      }
      printJson(created);
    });

  wallet
    .command("import")
    .requiredOption("--key <privateKey>", "0x-prefixed private key")
    .option("--label <label>", "wallet label")
    .action(async (opts: { key: string; label?: string }) => {
      const b = getBundler();
      const w = await b.wallets.importWallet(opts.key as Hex, opts.label);
      printJson({ address: w.address, label: w.label });
    });

  wallet
    .command("list")
    .action(async () => {
      const b = getBundler();
      const list = await b.wallets.listWallets();
      printJson(list.map((w) => ({ address: w.address, label: w.label, createdAt: w.createdAt })));
    });

  wallet
    .command("status")
    .argument("<address>", "wallet address")
    .action(async (address: string) => {
      const b = getBundler();
      printJson(await b.wallets.getWalletStatus(address as Address));
    });

  wallet
    .command("export")
    .description("Export wallet addresses (no private keys)")
    .option("--csv", "print CSV instead of JSON")
    .action(async (opts: { csv?: boolean }) => {
      const b = getBundler();
      const list = await b.wallets.listWallets();
      if (opts.csv) {
        console.log("address,label,createdAt");
        for (const w of list) {
          console.log(`${w.address},${JSON.stringify(w.label)},${w.createdAt}`);
        }
        return;
      }
      printJson(list.map((w) => ({ address: w.address, label: w.label, createdAt: w.createdAt })));
    });

  wallet
    .command("fund")
    .requiredOption("--from <address>")
    .requiredOption("--to <address>")
    .requiredOption("--amount <eth>")
    .action(async (opts: { from: string; to: string; amount: string }) => {
      const b = getBundler();
      printJson(
        await b.wallets.fundWallet(
          opts.from as Address,
          opts.to as Address,
          opts.amount,
        ),
      );
    });

  wallet
    .command("consolidate")
    .requiredOption("--from <address>")
    .requiredOption("--to <address>")
    .option("--leave <eth>", "ETH to leave for gas")
    .action(async (opts: { from: string; to: string; leave?: string }) => {
      const b = getBundler();
      printJson(
        await b.wallets.consolidateWallet(
          opts.from as Address,
          opts.to as Address,
          opts.leave,
        ),
      );
    });

  const bundle = program.command("bundle").description("Bundle lifecycle");

  bundle
    .command("create")
    .requiredOption("--name <name>")
    .option("--token <address>")
    .action(async (opts: { name: string; token?: string }) => {
      const b = getBundler();
      const created = await b.bundles.createBundle(
        opts.name,
        opts.token as Address | undefined,
      );
      printJson(created);
    });

  bundle
    .command("list")
    .action(async () => {
      const b = getBundler();
      const list = await b.bundles.list();
      printJson(
        list.map((x) => ({
          id: x.id,
          name: x.name,
          token: x.token,
          wallets: x.wallets.length,
          actions: x.actions.length,
          status: x.status,
          mode: x.mode,
        })),
      );
    });

  bundle
    .command("show")
    .argument("<id>")
    .action(async (id: string) => {
      const b = getBundler();
      const item = await b.bundles.get(id);
      if (!item) {
        console.error("Bundle not found");
        process.exitCode = 1;
        return;
      }
      printJson(item);
    });

  bundle
    .command("summary")
    .argument("<id>")
    .action(async (id: string) => {
      const b = getBundler();
      printJson(await b.bundles.summarize(id));
    });

  bundle
    .command("add-wallet")
    .argument("<id>")
    .requiredOption("--wallet <address>")
    .action(async (id: string, opts: { wallet: string }) => {
      const b = getBundler();
      printJson(await b.bundles.addWallet(id, opts.wallet as Address));
    });

  bundle
    .command("add-buy")
    .argument("<id>")
    .requiredOption("--wallet <address>")
    .requiredOption("--amount <eth>")
    .option("--token <address>")
    .option("--dex <name>", "mock | uniswap-v2")
    .action(
      async (
        id: string,
        opts: { wallet: string; amount: string; token?: string; dex?: string },
      ) => {
        const b = getBundler();
        printJson(
          await b.bundles.addBuyActions(
            id,
            [{ wallet: opts.wallet as Address, amountEth: opts.amount }],
            {
              token: opts.token as Address | undefined,
              dex: opts.dex,
            },
          ),
        );
      },
    );

  bundle
    .command("validate")
    .argument("<id>")
    .action(async (id: string) => {
      const b = getBundler();
      printJson(await b.bundles.validateBundle(id));
    });

  bundle
    .command("simulate")
    .argument("<id>")
    .action(async (id: string) => {
      const b = getBundler();
      const item = await b.bundles.get(id);
      if (!item) throw new Error("Bundle not found");
      printJson(await b.simulator.simulateBundle(item));
    });

  bundle
    .command("execute")
    .argument("<id>")
    .action(async (id: string) => {
      const b = getBundler();
      const result = await b.executor.executeBundle(id);
      printJson({
        id: result.id,
        status: result.status,
        summary: await b.bundles.summarize(id),
        metrics: b.executor.getLastMetrics(),
        actions: result.actions.map((a) => ({
          id: a.id,
          wallet: a.walletAddress,
          type: a.type,
          status: a.status,
          txHash: a.txHash,
          submitLatencyMs: a.submitLatencyMs,
          confirmLatencyMs: a.confirmLatencyMs,
          error: a.error,
        })),
      });
    });

  bundle
    .command("dashboard")
    .argument("<id>")
    .description("ASCII dashboard for a bundle")
    .action(async (id: string) => {
      const b = getBundler();
      console.log(await b.dashboard(id));
    });

  bundle
    .command("clone")
    .argument("<id>")
    .option("--name <name>")
    .action(async (id: string, opts: { name?: string }) => {
      const b = getBundler();
      printJson(await b.bundles.cloneBundle(id, opts.name));
    });

  bundle
    .command("add-buy-plan")
    .argument("<id>")
    .requiredOption("--plan <json>", 'JSON array: [{"wallet":"0x..","amountEth":"0.1"}]')
    .option("--token <address>")
    .option("--dex <name>")
    .action(async (id: string, opts: { plan: string; token?: string; dex?: string }) => {
      const b = getBundler();
      const plans = JSON.parse(opts.plan) as { wallet: Address; amountEth: string }[];
      printJson(
        await b.bundles.addBuyPlan(id, plans, {
          token: opts.token as Address | undefined,
          dex: opts.dex,
        }),
      );
    });

  bundle
    .command("funding-plan")
    .argument("<id>")
    .option("--funder <address>")
    .option("--attach", "persist plan on the bundle")
    .action(async (id: string, opts: { funder?: string; attach?: boolean }) => {
      const b = getBundler();
      if (opts.attach) {
        await b.funding.attachPlan(id, opts.funder as Address | undefined);
      }
      const bundle = await b.bundles.get(id);
      if (!bundle) throw new Error("Bundle not found");
      printJson(await b.funding.analyze(bundle, opts.funder as Address | undefined));
    });

  bundle
    .command("funding-execute")
    .argument("<id>")
    .description("Fund wallets according to attached/computed funding plan")
    .action(async (id: string) => {
      const b = getBundler();
      printJson(await b.funding.executePlan(id));
    });

  bundle
    .command("retry-failed")
    .argument("<id>")
    .action(async (id: string) => {
      const b = getBundler();
      printJson(await b.executor.retryFailed(id));
    });

  bundle
    .command("resume")
    .argument("<id>")
    .action(async (id: string) => {
      const b = getBundler();
      printJson(await b.executor.resumeBundle(id));
    });

  bundle
    .command("reconcile")
    .argument("<id>")
    .action(async (id: string) => {
      const b = getBundler();
      printJson(await b.executor.reconcileBundle(id));
    });

  bundle
    .command("cancel")
    .argument("<id>")
    .action(async (id: string) => {
      const b = getBundler();
      printJson(await b.bundles.cancelBundle(id));
    });

  const gas = program.command("gas").description("Gas utilities");

  gas
    .command("price")
    .action(async () => {
      const b = getBundler();
      const fees = await b.gas.getGasPrice();
      printJson({
        maxFeePerGas: fees.maxFeePerGas.toString(),
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
      });
    });

  gas
    .command("check")
    .argument("<addresses...>")
    .action(async (addresses: string[]) => {
      const b = getBundler();
      const report = await b.gas.checkGasBalances(addresses as Address[]);
      printJson({
        ...report,
        availableGasEth: formatEther(report.availableGasWei),
      });
    });

  gas
    .command("distribute")
    .requiredOption("--from <address>")
    .requiredOption("--amount <eth>")
    .argument("<recipients...>")
    .action(async (recipients: string[], opts: { from: string; amount: string }) => {
      const b = getBundler();
      printJson(
        await b.gas.distributeGas(
          opts.from as Address,
          recipients as Address[],
          opts.amount,
        ),
      );
    });

  const token = program.command("token").description("Token helpers");

  token
    .command("meta")
    .argument("<address>")
    .action(async (address: string) => {
      const b = getBundler();
      const meta = await b.tokens.getTokenMetadata(address as Address);
      printJson({
        name: meta.name,
        symbol: meta.symbol,
        decimals: meta.decimals,
        totalSupply: meta.totalSupply.toString(),
      });
    });

  token
    .command("deploy")
    .requiredOption("--from <address>")
    .requiredOption("--name <name>")
    .requiredOption("--symbol <symbol>")
    .requiredOption("--supply <amount>", "whole tokens (18 decimals assumed)")
    .action(
      async (opts: {
        from: string;
        name: string;
        symbol: string;
        supply: string;
      }) => {
        const b = getBundler();
        const result = await b.tokens.deployToken({
          from: opts.from as Address,
          name: opts.name,
          symbol: opts.symbol,
          initialSupply: parseEther(opts.supply),
        });
        printJson({
          simulated: result.simulated,
          address: result.address,
          hash: result.hash,
        });
      },
    );

  const tx = program.command("tx").description("Transaction history");

  tx
    .command("list")
    .option("--bundle <id>")
    .action(async (opts: { bundle?: string }) => {
      const b = getBundler();
      const rows = opts.bundle
        ? await b.txRepo.byBundle(opts.bundle)
        : await b.txRepo.list();
      printJson(rows);
    });

  program
    .command("metrics")
    .description("Show last execution latency metrics (in-memory)")
    .action(async () => {
      const b = getBundler();
      printJson(b.executor.getLastMetrics());
    });

  program
    .command("demo")
    .description("Create wallets + sample buy bundle in simulation mode")
    .option("--token <address>", "token address", "0x00000000000000000000000000000000000000aa")
    .action(async (opts: { token: string }) => {
      const b = Bundler.create({ mode: "simulation" });
      const w1 = await b.wallets.createWallet("demo-1");
      const w2 = await b.wallets.createWallet("demo-2");
      const w3 = await b.wallets.createWallet("demo-3");
      const created = await b.bundles.createBundle("demo-bundle", opts.token as Address);
      await b.bundles.addBuyActions(created.id, [
        { wallet: w1.address, amountEth: "0.10" },
        { wallet: w2.address, amountEth: "0.15" },
        { wallet: w3.address, amountEth: "0.20" },
      ]);
      const validated = await b.bundles.validateBundle(created.id);
      const simulated = await b.simulator.simulateBundle(validated.bundle);
      const executed = await b.executor.executeBundle(created.id);
      console.log(await b.dashboard(created.id));
      printJson({
        mode: b.config.mode,
        network: b.config.network,
        chainId: b.rpc.chain.id,
        wallets: [w1.address, w2.address, w3.address],
        bundleId: created.id,
        validation: validated.ok,
        simulation: simulated,
        metrics: b.executor.getLastMetrics(),
        summary: await b.bundles.summarize(created.id),
        status: executed.status,
      });
    });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

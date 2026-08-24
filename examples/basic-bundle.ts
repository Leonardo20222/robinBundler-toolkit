/**
 * Minimal programmatic example (simulation mode).
 * Run: npx tsx examples/basic-bundle.ts
 */
import { Bundler } from "../src/index.js";

async function main() {
  const bundler = Bundler.create({
    mode: "simulation",
    network: "testnet",
    dataDir: "./data/example",
  });

  const wallets = await Promise.all([
    bundler.wallets.createWallet("ex-1"),
    bundler.wallets.createWallet("ex-2"),
  ]);

  const bundle = await bundler.bundles.createBundle(
    "example-batch",
    "0x00000000000000000000000000000000000000aa",
  );

  await bundler.bundles.addBuyPlan(
    bundle.id,
    wallets.map((w, i) => ({
      wallet: w.address,
      amountEth: i === 0 ? "0.05" : "0.08",
    })),
  );

  await bundler.funding.attachPlan(bundle.id);
  const funding = await bundler.funding.analyze(
    (await bundler.bundles.get(bundle.id))!,
  );

  await bundler.bundles.validateBundle(bundle.id);
  await bundler.executor.executeBundle(bundle.id);

  console.log(await bundler.dashboard(bundle.id));
  console.log(
    JSON.stringify(
      {
        funding,
        metrics: bundler.executor.getLastMetrics(),
        summary: await bundler.bundles.summarize(bundle.id),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

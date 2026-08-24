# Robinhood Token Bundler

Multi-wallet transaction orchestration for [Robinhood Chain](https://docs.robinhood.com/chain/) (EVM L2, ETH gas, FCFS sequencing).

Default mode is **simulation** (no broadcasts). Switch to `live` only when you intend to send real transactions.

## Network

| Network | Chain ID | Public RPC | Sequencer |
|---------|----------|------------|-----------|
| Mainnet | `4663` | `https://rpc.mainnet.chain.robinhood.com` | `https://sequencer.mainnet.chain.robinhood.com` |
| Testnet | `46630` | `https://rpc.testnet.chain.robinhood.com` | `https://sequencer.testnet.chain.robinhood.com` |

Alchemy is recommended for production. Set `ALCHEMY_API_KEY` or `RPC_URL` in `.env`. See [connecting docs](https://docs.robinhood.com/chain/connecting/).

## Quick start

```bash
cd robinhood
cp .env.example .env
npm install
npm run build

# Paper demo (simulation): creates wallets + buy bundle + execute + dashboard
npm run dev -- demo

# Health check (RPC + sequencer ping)
npm run dev -- health
```

## What is implemented

| Module | Role |
|--------|------|
| `WalletManager` | create/import/encrypt wallets, balances, fund, consolidate, export |
| `NonceManager` | reserve / release / reconcile nonces across workers |
| `RpcManager` | multi-endpoint failover, latency/health checks |
| `SequencerClient` | optional raw-tx submit to Robinhood sequencer (FCFS) |
| `SubmissionMetrics` | submit/confirm latency p50/p95 for tuning concurrency |
| `GasManager` | fee estimates, gas distribution, wallet gas audits |
| `FundingPlanner` | compute + execute per-wallet funding for a bundle |
| `TokenManager` | ERC-20 metadata, transfer/approve/mint/burn, deploy hook |
| `DexManager` + adapters | pluggable DEX quotes/swaps (`mock`, optional Uniswap V2) |
| `BundleBuilder` | create/clone bundles, buy plans, validate, cancel |
| `Simulator` | dry-run balances, calldata, gas |
| `ExecutionEngine` | parallel workers, lifecycle states, retry/resume/reconcile |
| `EventMonitor` | Transfer / Approval / Swap log subscriptions |
| Dashboard | ASCII bundle status board |
| CLI | full lifecycle from the terminal |

## Architecture

```text
Bundler
  ├── WalletManager + NonceManager
  ├── BundleBuilder + FundingPlanner
  ├── ExecutionEngine ──► DexAdapter ──► RPC / Sequencer
  ├── GasManager + RpcManager + SubmissionMetrics
  ├── TokenManager
  └── Simulator / EventMonitor / Dashboard
```

Actions are generic EVM calls (`SWAP`, `APPROVE`, `TRANSFER`, `CONTRACT_CALL`, …), so the engine stays strategy-agnostic.

## CLI examples

```bash
# Create 5 wallets + export addresses
npm run dev -- wallet create traders --count 5
npm run dev -- wallet export --csv

# Create a bundle targeting a token
npm run dev -- bundle create --name launch-1 --token 0xYourToken

# Single buy or bulk buy plan
npm run dev -- bundle add-buy <bundleId> --wallet 0x... --amount 0.1
npm run dev -- bundle add-buy-plan <bundleId> --plan '[{"wallet":"0x...","amountEth":"0.1"}]'

# Funding plan (attach + optionally execute)
npm run dev -- bundle funding-plan <bundleId> --funder 0xFunder --attach
npm run dev -- bundle funding-execute <bundleId>

# Validate → simulate → execute → dashboard
npm run dev -- bundle validate <bundleId>
npm run dev -- bundle simulate <bundleId>
npm run dev -- --mode simulation bundle execute <bundleId>
npm run dev -- bundle dashboard <bundleId>

# Clone + recovery
npm run dev -- bundle clone <bundleId> --name launch-1-retry
npm run dev -- bundle retry-failed <bundleId>
npm run dev -- bundle resume <bundleId>
npm run dev -- bundle reconcile <bundleId>

# Tx history
npm run dev -- tx list --bundle <bundleId>
```

## Live DEX + sequencer

```bash
# .env
DEX_ROUTER_ADDRESS=0x...
WETH_ADDRESS=0x...
BUNDLER_MODE=live
USE_SEQUENCER=true   # sign locally, eth_sendRawTransaction to sequencer
```

Until a DEX is live, the **mock** adapter supports full pipeline testing without an AMM.

Because Robinhood Chain uses first-come-first-served sequencing, tune `MAX_CONCURRENCY` using submission latency metrics rather than gas bidding.

## Token deploy note

`TokenManager.deployToken` includes ABI + placeholder bytecode for plumbing. For production deploys, compile `contracts/SimpleERC20.sol` with Foundry/Hardhat and replace `src/token/SimpleERC20.ts` bytecode with the artifact.

## Data

Local JSON under `./data` (gitignored):

- `wallets.json` — encrypted private keys (AES-256-GCM)
- `bundles.json` — bundle definitions + action states
- `transactions.json` — execution history

Set a strong `WALLET_PASSPHRASE` before storing real keys.

## Tests & example

```bash
# unit tests (node:test, no extra deps)
npx tsx --test src/utils/concurrency.test.ts

# programmatic example
npx tsx examples/basic-bundle.ts
```

## Programmatic use

```ts
import { Bundler } from "robinhood-token-bundler";

const bundler = Bundler.create({ mode: "simulation", network: "testnet" });
const wallet = await bundler.wallets.createWallet("bot-1");
const bundle = await bundler.bundles.createBundle("batch", "0xToken");
await bundler.bundles.addBuyActions(bundle.id, [
  { wallet: wallet.address, amountEth: "0.05" },
]);
await bundler.executor.executeBundle(bundle.id);
console.log(await bundler.dashboard(bundle.id));
```

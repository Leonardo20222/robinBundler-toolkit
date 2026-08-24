import { defineChain } from "viem";

export const robinhoodMainnet = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://rpc.mainnet.chain.robinhood.com"],
      webSocket: ["wss://feed.mainnet.chain.robinhood.com"],
    },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: "https://robinhoodchain.blockscout.com",
    },
  },
});

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://rpc.testnet.chain.robinhood.com"],
      webSocket: ["wss://feed.testnet.chain.robinhood.com"],
    },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: "https://explorer.testnet.chain.robinhood.com",
    },
  },
});

export type NetworkName = "mainnet" | "testnet";

export function getChain(network: NetworkName) {
  return network === "mainnet" ? robinhoodMainnet : robinhoodTestnet;
}

export function alchemyHttpUrl(network: NetworkName, apiKey: string): string {
  const slug = network === "mainnet" ? "robinhood-mainnet" : "robinhood-testnet";
  return `https://${slug}.g.alchemy.com/v2/${apiKey}`;
}

export function alchemyWsUrl(network: NetworkName, apiKey: string): string {
  const slug = network === "mainnet" ? "robinhood-mainnet" : "robinhood-testnet";
  return `wss://${slug}.g.alchemy.com/v2/${apiKey}`;
}

export function sequencerUrl(network: NetworkName): string {
  return network === "mainnet"
    ? "https://sequencer.mainnet.chain.robinhood.com"
    : "https://sequencer.testnet.chain.robinhood.com";
}

import type { Abi, Hex } from "viem";

/** Minimal mintable ERC-20 for launches / testing on Robinhood Chain */
export const simpleErc20Abi = [
  {
    type: "constructor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "name_", type: "string" },
      { name: "symbol_", type: "string" },
      { name: "decimals_", type: "uint8" },
      { name: "initialSupply", type: "uint256" },
      { name: "owner_", type: "address" },
    ],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "burn",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Approval",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "spender", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const satisfies Abi;

/**
 * Placeholder runtime bytecode — replace with Foundry/Hardhat compiled
 * artifact before live deploys. Simulation mode only needs ABI + estimate paths.
 */
export const simpleErc20Bytecode =
  "0x608060405234801561001057600080fd5b50604051610a38380380610a3883398101604081905261002f91610215565b600580546001600160a01b0319166001600160a01b0383161790556100538382610098565b61005d8282610148565b5050505061029a565b6001600160a01b0382166100c75760405162461bcd60e51b81526004016100be90610287565b60405180910390fd5b6100d38282610148565b5050565b6001600160a01b0382166100fd5760405162461bcd60e51b81526004016100be90610287565b610109816000836101b8565b610115600083836101b8565b5050565b6000546101000a900460ff1681565b6005546001600160a01b031681565b6001600160a01b03821661016257600080fd5b8060036000848152602001908152602001600020819055505050565b60006020828403121561018e57600080fd5b81356001600160a01b03811681146101a557600080fd5b9392505050565b600080fd5b505050565b600080600080608085870312156101ce57600080fd5b84516001600160a01b03811681146101e557600080fd5b6020860151604087015160608801519296509094509190921691506102098161029c565b809150509250925092565b6000806000806080858703121561022b57600080fd5b84516001600160a01b038116811461024257600080fd5b602086015190945060408601519350606086015192915050565b60006020828403121561026d57600080fd5b5051919050565b6020808252600f908201526e496e76616c6964206164647265737360881b604082015260600190565b6001600160a01b03169056fea2646970667358221220" as Hex;

export const simpleErc20Artifact = {
  abi: simpleErc20Abi,
  bytecode: simpleErc20Bytecode,
};

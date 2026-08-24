import type { Address, Hash, Hex } from "viem";

export type ExecutionMode = "simulation" | "live";

export type TxLifecycleStatus =
  | "CREATED"
  | "VALIDATED"
  | "SIMULATED"
  | "SIGNED"
  | "SUBMITTED"
  | "CONFIRMED"
  | "SIMULATION_FAILED"
  | "SUBMISSION_FAILED"
  | "REVERTED"
  | "TIMEOUT"
  | "NONCE_ERROR"
  | "INSUFFICIENT_GAS"
  | "CANCELLED";

export type ActionType =
  | "TRANSFER"
  | "APPROVE"
  | "SWAP"
  | "DEPLOY_TOKEN"
  | "CONTRACT_CALL"
  | "CUSTOM";

export interface BundleAction {
  id: string;
  type: ActionType;
  walletAddress: Address;
  /** Target contract or recipient */
  target?: Address;
  /** ETH value in wei as string */
  valueWei?: string;
  calldata?: Hex;
  /** Human-readable params for adapters */
  params?: Record<string, unknown>;
  status: TxLifecycleStatus;
  txHash?: Hash;
  nonce?: number;
  gasUsed?: string;
  error?: string;
  blockNumber?: string;
  submittedAt?: string;
  confirmedAt?: string;
  /** Milliseconds from sign/send start to RPC/sequencer ack */
  submitLatencyMs?: number;
  /** Milliseconds from submit ack to receipt */
  confirmLatencyMs?: number;
}

export interface FundingPlan {
  funderAddress?: Address;
  perWalletWei: string;
  minGasWei: string;
}

export interface GasPlan {
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasLimitBufferBps: number;
}

export interface Bundle {
  id: string;
  name: string;
  token?: Address;
  wallets: Address[];
  actions: BundleAction[];
  fundingPlan?: FundingPlan;
  gasPlan: GasPlan;
  status: TxLifecycleStatus | "PARTIAL" | "COMPLETED";
  createdAt: string;
  updatedAt: string;
  mode: ExecutionMode;
}

export interface ManagedWallet {
  address: Address;
  label: string;
  createdAt: string;
  /** AES-GCM encrypted private key payload */
  encryptedPrivateKey: string;
  /** Hex IV for decryption */
  iv: string;
  /** Hex auth tag / salt metadata */
  salt: string;
}

export interface WalletStatus {
  address: Address;
  label: string;
  ethBalanceWei: string;
  ethBalanceEth: string;
  hasMinGas: boolean;
  confirmedNonce: number;
  pendingNonce: number;
}

export interface NonceState {
  address: Address;
  confirmed: number;
  pending: number;
  reserved: number[];
}

export interface SwapQuote {
  amountIn: bigint;
  amountOut: bigint;
  amountOutMin: bigint;
  path: Address[];
  router: Address;
  deadline: number;
}

export interface BundleSummary {
  id: string;
  name: string;
  wallets: number;
  successful: number;
  failed: number;
  pending: number;
  gasSpentWei: string;
  status: Bundle["status"];
}

export interface RecordedTransaction {
  id: string;
  bundleId: string;
  actionId: string;
  wallet: Address;
  txHash?: Hash;
  nonce?: number;
  actionType: ActionType;
  amount?: string;
  gasUsed?: string;
  status: TxLifecycleStatus;
  blockNumber?: string;
  timestamp: string;
  error?: string;
}

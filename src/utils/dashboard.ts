import { formatEther } from "viem";
import type { Bundle, BundleSummary } from "../types.js";

export function renderBundleDashboard(
  bundle: Bundle,
  summary: BundleSummary,
  extras?: {
    tokenBoughtHint?: string;
    estimatedGasEth?: string;
  },
): string {
  const lines = [
    "┌──────────────────────────────────────────┐",
    `│ Bundle ${truncate(bundle.id, 34).padEnd(34)}│`,
    `│ Name: ${truncate(bundle.name, 35).padEnd(35)}│`,
    `│ Token: ${truncate(bundle.token ?? "(none)", 34).padEnd(34)}│`,
    `│ Mode: ${bundle.mode.padEnd(36)}│`,
    "│                                          │",
    `│ Wallets       ${String(summary.wallets).padStart(24)} │`,
    `│ Successful    ${String(summary.successful).padStart(24)} │`,
    `│ Failed        ${String(summary.failed).padStart(24)} │`,
    `│ Pending       ${String(summary.pending).padStart(24)} │`,
    "│                                          │",
    `│ Gas spent     ${formatEther(BigInt(summary.gasSpentWei || "0")).padStart(24)} │`,
  ];

  if (extras?.estimatedGasEth) {
    lines.push(
      `│ Est. gas ETH  ${extras.estimatedGasEth.padStart(24)} │`,
    );
  }
  if (extras?.tokenBoughtHint) {
    lines.push(
      `│ Token note    ${truncate(extras.tokenBoughtHint, 24).padStart(24)} │`,
    );
  }

  lines.push(
    `│ Status        ${String(summary.status).padStart(24)} │`,
    "└──────────────────────────────────────────┘",
  );

  const tableHeader =
    "\nWallet                                   Type         Status              TX / Error";
  const tableRule = "-".repeat(100);
  const rows = bundle.actions.map((a) => {
    const wallet = a.walletAddress;
    const type = a.type.padEnd(12);
    const status = a.status.padEnd(18);
    const detail = a.txHash ?? a.error ?? "-";
    return `${wallet}  ${type} ${status} ${truncate(detail, 40)}`;
  });

  return [...lines, tableHeader, tableRule, ...rows].join("\n");
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

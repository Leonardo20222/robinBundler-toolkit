import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapPool, RateLimiter } from "./concurrency.js";
import { renderBundleDashboard } from "./dashboard.js";
import type { Bundle, BundleSummary } from "../types.js";
import { SubmissionMetrics } from "../chain/SubmissionMetrics.js";

describe("mapPool", () => {
  it("preserves order with concurrency", async () => {
    const out = await mapPool([1, 2, 3, 4, 5], 2, async (n) => n * 10);
    assert.deepEqual(out, [10, 20, 30, 40, 50]);
  });

  it("handles empty input", async () => {
    const out = await mapPool([], 3, async (n: number) => n);
    assert.deepEqual(out, []);
  });
});

describe("RateLimiter", () => {
  it("allows bursts up to max tokens", async () => {
    const limiter = new RateLimiter(3, 100);
    const started = Date.now();
    await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()]);
    assert.ok(Date.now() - started < 200);
  });
});

describe("SubmissionMetrics", () => {
  it("computes averages and percentiles", () => {
    const m = new SubmissionMetrics();
    m.record({ actionId: "a", wallet: "0x1", submitLatencyMs: 10, ok: true });
    m.record({ actionId: "b", wallet: "0x2", submitLatencyMs: 20, ok: true });
    m.record({ actionId: "c", wallet: "0x3", submitLatencyMs: 30, ok: false, error: "x" });
    const snap = m.snapshot();
    assert.equal(snap.count, 3);
    assert.equal(snap.success, 2);
    assert.equal(snap.failed, 1);
    assert.equal(snap.avgSubmitMs, 15);
    assert.equal(snap.p50SubmitMs, 15);
  });
});

describe("renderBundleDashboard", () => {
  it("renders key fields", () => {
    const bundle: Bundle = {
      id: "bundle-1",
      name: "test",
      token: "0xabc",
      wallets: ["0x1111111111111111111111111111111111111111"],
      actions: [
        {
          id: "act-1",
          type: "SWAP",
          walletAddress: "0x1111111111111111111111111111111111111111",
          status: "CONFIRMED",
          txHash: "0xdead",
        },
      ],
      gasPlan: { gasLimitBufferBps: 1000 },
      status: "COMPLETED",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mode: "simulation",
    };
    const summary: BundleSummary = {
      id: bundle.id,
      name: bundle.name,
      wallets: 1,
      successful: 1,
      failed: 0,
      pending: 0,
      gasSpentWei: "0",
      status: "COMPLETED",
    };
    const text = renderBundleDashboard(bundle, summary);
    assert.match(text, /Bundle/);
    assert.match(text, /Successful/);
    assert.match(text, /CONFIRMED/);
  });
});

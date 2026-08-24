export type SubmissionSample = {
  actionId: string;
  wallet: string;
  submitLatencyMs: number;
  confirmLatencyMs?: number;
  ok: boolean;
  error?: string;
};

/**
 * Tracks submission-to-sequencer / confirmation latency for FCFS tuning.
 */
export class SubmissionMetrics {
  private samples: SubmissionSample[] = [];

  record(sample: SubmissionSample): void {
    this.samples.push(sample);
  }

  reset(): void {
    this.samples = [];
  }

  snapshot(): {
    count: number;
    success: number;
    failed: number;
    avgSubmitMs: number;
    p50SubmitMs: number;
    p95SubmitMs: number;
    avgConfirmMs: number | null;
    samples: SubmissionSample[];
  } {
    const ok = this.samples.filter((s) => s.ok);
    const submit = ok.map((s) => s.submitLatencyMs).sort((a, b) => a - b);
    const confirm = ok
      .map((s) => s.confirmLatencyMs)
      .filter((v): v is number => typeof v === "number")
      .sort((a, b) => a - b);

    return {
      count: this.samples.length,
      success: ok.length,
      failed: this.samples.length - ok.length,
      avgSubmitMs: average(submit),
      p50SubmitMs: percentile(submit, 0.5),
      p95SubmitMs: percentile(submit, 0.95),
      avgConfirmMs: confirm.length ? average(confirm) : null,
      samples: [...this.samples],
    };
  }
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const weight = idx - lo;
  return Math.round(sorted[lo]! * (1 - weight) + sorted[hi]! * weight);
}

import { describe, expect, test } from "bun:test";
import type { OhaMetrics } from "./oha.ts";
import { type BenchmarkResult, formatReport } from "./report.ts";

function metrics(requestsPerSecond: number, p50: number, p95: number): OhaMetrics {
  return {
    successRate: 1,
    requestsPerSecond,
    latencyMs: { mean: p50, p50, p95, p99: p95 },
  };
}

describe("benchmark report", () => {
  test("reports latency deltas and throughput ratios", () => {
    const result: BenchmarkResult = {
      payloadBytes: 4_096,
      directLatency: metrics(1_000, 1, 2),
      shallotLatency: metrics(250, 5, 8),
      directThroughput: metrics(1_000, 1, 2),
      shallotThroughput: metrics(250, 5, 8),
    };

    const report = formatReport([result], {
      latencyRequests: 10,
      throughputRequests: 100,
      concurrency: 4,
      elapsedSeconds: 1.25,
    });

    expect(report).toContain("| 4096 | 1.00 ms | 5.00 ms | 4.00 ms");
    expect(report).toContain("| 4096 | 1000 | 250 | 0.25x | 75.0% |");
  });
});

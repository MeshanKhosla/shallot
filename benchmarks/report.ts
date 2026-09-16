import { cpus } from "node:os";
import type { OhaMetrics } from "./oha.ts";

export interface BenchmarkResult {
  payloadBytes: number;
  directLatency: OhaMetrics;
  shallotLatency: OhaMetrics;
  directThroughput: OhaMetrics;
  shallotThroughput: OhaMetrics;
}

function fixed(value: number, digits = 2): string {
  return value.toFixed(digits);
}

export function formatReport(
  results: BenchmarkResult[],
  options: {
    latencyRequests: number;
    throughputRequests: number;
    concurrency: number;
    elapsedSeconds: number;
  },
): string {
  const lines = [
    "# Shallot benchmark results",
    "",
    `- Recorded: ${new Date().toISOString()}`,
    `- Bun: ${Bun.version}`,
    `- Platform: ${process.platform} ${process.arch}`,
    `- CPU: ${cpus()[0]?.model ?? "unknown"}`,
    `- Latency samples: ${options.latencyRequests} per path at concurrency 1`,
    `- Throughput samples: ${options.throughputRequests} per path at concurrency ${options.concurrency}`,
    `- Total benchmark time: ${fixed(options.elapsedSeconds)} seconds`,
    "- Provider: deterministic local mock with no inference or artificial delay",
    "",
    "## Latency",
    "",
    "| Request bytes | Direct p50 | Shallot p50 | Added p50 | Direct p95 | Shallot p95 | Added p95 |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const result of results) {
    lines.push(
      `| ${result.payloadBytes} | ${fixed(result.directLatency.latencyMs.p50)} ms | ${fixed(result.shallotLatency.latencyMs.p50)} ms | ${fixed(result.shallotLatency.latencyMs.p50 - result.directLatency.latencyMs.p50)} ms | ${fixed(result.directLatency.latencyMs.p95)} ms | ${fixed(result.shallotLatency.latencyMs.p95)} ms | ${fixed(result.shallotLatency.latencyMs.p95 - result.directLatency.latencyMs.p95)} ms |`,
    );
  }

  lines.push(
    "",
    "## Throughput",
    "",
    "| Request bytes | Direct req/s | Shallot req/s | Shallot / direct | Reduction |",
    "| ---: | ---: | ---: | ---: | ---: |",
  );
  for (const result of results) {
    const ratio =
      result.shallotThroughput.requestsPerSecond /
      result.directThroughput.requestsPerSecond;
    lines.push(
      `| ${result.payloadBytes} | ${fixed(result.directThroughput.requestsPerSecond, 0)} | ${fixed(result.shallotThroughput.requestsPerSecond, 0)} | ${fixed(ratio)}x | ${fixed((1 - ratio) * 100, 1)}% |`,
    );
  }

  lines.push(
    "",
    "The direct baseline and Shallot path call the same local mock provider. The added latency therefore measures local HTTP hops, authentication, parsing, padding, HPKE work, and framing. Absolute results vary by machine and background load.",
  );
  return `${lines.join("\n")}\n`;
}

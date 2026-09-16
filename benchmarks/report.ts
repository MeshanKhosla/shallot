import { cpus } from "node:os";
import type { OhaMetrics } from "./oha.ts";

export interface BenchmarkResult {
  payloadBytes: number;
  throughputRequests: number;
  directLatency: OhaMetrics;
  plainProxyLatency: OhaMetrics;
  shallotLatency: OhaMetrics;
  directThroughput: OhaMetrics;
  plainProxyThroughput: OhaMetrics;
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
    `- Throughput samples: up to ${options.throughputRequests} per path at concurrency ${options.concurrency}`,
    `- Total benchmark time: ${fixed(options.elapsedSeconds)} seconds`,
    "- Provider: deterministic local mock with no inference or artificial delay",
    "",
    "## Latency",
    "",
    "| Request bytes | Direct p50 | Plain proxy p50 | Shallot p50 | Shallot vs proxy | Direct p95 | Plain proxy p95 | Shallot p95 | Shallot vs proxy |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const result of results) {
    lines.push(
      `| ${result.payloadBytes} | ${fixed(result.directLatency.latencyMs.p50)} ms | ${fixed(result.plainProxyLatency.latencyMs.p50)} ms | ${fixed(result.shallotLatency.latencyMs.p50)} ms | ${fixed(result.shallotLatency.latencyMs.p50 - result.plainProxyLatency.latencyMs.p50)} ms | ${fixed(result.directLatency.latencyMs.p95)} ms | ${fixed(result.plainProxyLatency.latencyMs.p95)} ms | ${fixed(result.shallotLatency.latencyMs.p95)} ms | ${fixed(result.shallotLatency.latencyMs.p95 - result.plainProxyLatency.latencyMs.p95)} ms |`,
    );
  }

  lines.push(
    "",
    "## Throughput",
    "",
    "| Request bytes | Requests/path | Direct req/s | Plain proxy req/s | Shallot req/s | Shallot / proxy |",
    "| ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const result of results) {
    const ratio =
      result.shallotThroughput.requestsPerSecond /
      result.plainProxyThroughput.requestsPerSecond;
    lines.push(
      `| ${result.payloadBytes} | ${result.throughputRequests} | ${fixed(result.directThroughput.requestsPerSecond, 0)} | ${fixed(result.plainProxyThroughput.requestsPerSecond, 0)} | ${fixed(result.shallotThroughput.requestsPerSecond, 0)} | ${fixed(ratio)}x |`,
    );
  }

  lines.push(
    "",
    "All three paths call the same local mock provider. The plain proxy authenticates the tenant, replaces the provider credential, and streams the request and response without parsing or encryption. The Shallot versus proxy columns isolate the extra process hops, parsing, padding, HPKE work, and framing. Absolute results vary by machine and background load.",
  );
  return `${lines.join("\n")}\n`;
}

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireOha, runOha } from "./oha.ts";
import { type BenchmarkResult, formatReport } from "./report.ts";
import { startBenchmarkStack } from "./stack.ts";

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function payloadSizes(): number[] {
  const values = (process.env.BENCH_PAYLOAD_BYTES ?? "256,4096,32768,262144,1048576")
    .split(",")
    .map((value) => Number(value.trim()));
  if (
    values.length === 0 ||
    values.some((value) => !Number.isSafeInteger(value) || value < 128)
  ) {
    throw new Error(
      "BENCH_PAYLOAD_BYTES must be comma-separated integers of at least 128",
    );
  }
  return values;
}

function requestBody(targetBytes: number): string {
  const message = { role: "user", content: "" };
  const request = {
    model: "mock-text",
    messages: [message],
  };
  const empty = JSON.stringify(request);
  message.content = "x".repeat(Math.max(0, targetBytes - empty.length));
  return JSON.stringify(request);
}

async function main(): Promise<void> {
  const latencyRequests = positiveInteger("BENCH_LATENCY_REQUESTS", 300);
  const throughputRequests = positiveInteger("BENCH_THROUGHPUT_REQUESTS", 10_000);
  const throughputByteBudget = positiveInteger(
    "BENCH_THROUGHPUT_BYTE_BUDGET",
    256 * 1024 * 1024,
  );
  const concurrency = positiveInteger("BENCH_CONCURRENCY", 32);
  const warmupRequests = positiveInteger("BENCH_WARMUP_REQUESTS", 50);
  const oha = await requireOha();
  const payloadDirectory = await mkdtemp(join(tmpdir(), "shallot-benchmark-"));

  try {
    const stack = await startBenchmarkStack();
    const startedAt = Bun.nanoseconds();
    try {
      const warmupBody = requestBody(4_096);
      const warmupBodyPath = join(payloadDirectory, "warmup.json");
      await writeFile(warmupBodyPath, warmupBody);
      await runOha(oha, {
        url: stack.directUrl,
        authorization: stack.directAuthorization,
        bodyPath: warmupBodyPath,
        requests: warmupRequests,
        concurrency: 4,
        quiet: true,
      });
      await runOha(oha, {
        url: stack.plainProxyUrl,
        authorization: stack.plainProxyAuthorization,
        bodyPath: warmupBodyPath,
        requests: warmupRequests,
        concurrency: 4,
        quiet: true,
      });
      await runOha(oha, {
        url: stack.shallotUrl,
        authorization: stack.shallotAuthorization,
        bodyPath: warmupBodyPath,
        requests: warmupRequests,
        concurrency: 4,
        quiet: true,
      });

      const results: BenchmarkResult[] = [];
      for (const targetBytes of payloadSizes()) {
        const body = requestBody(targetBytes);
        const bodyPath = join(payloadDirectory, `${targetBytes}.json`);
        await writeFile(bodyPath, body);
        const throughputRequestCount = Math.min(
          throughputRequests,
          Math.max(concurrency, Math.floor(throughputByteBudget / targetBytes)),
        );
        const directLatency = await runOha(oha, {
          url: stack.directUrl,
          authorization: stack.directAuthorization,
          bodyPath,
          requests: latencyRequests,
          concurrency: 1,
        });
        const plainProxyLatency = await runOha(oha, {
          url: stack.plainProxyUrl,
          authorization: stack.plainProxyAuthorization,
          bodyPath,
          requests: latencyRequests,
          concurrency: 1,
        });
        const shallotLatency = await runOha(oha, {
          url: stack.shallotUrl,
          authorization: stack.shallotAuthorization,
          bodyPath,
          requests: latencyRequests,
          concurrency: 1,
        });
        const directThroughput = await runOha(oha, {
          url: stack.directUrl,
          authorization: stack.directAuthorization,
          bodyPath,
          requests: throughputRequestCount,
          concurrency,
        });
        const plainProxyThroughput = await runOha(oha, {
          url: stack.plainProxyUrl,
          authorization: stack.plainProxyAuthorization,
          bodyPath,
          requests: throughputRequestCount,
          concurrency,
        });
        const shallotThroughput = await runOha(oha, {
          url: stack.shallotUrl,
          authorization: stack.shallotAuthorization,
          bodyPath,
          requests: throughputRequestCount,
          concurrency,
        });

        for (const measurement of [
          directLatency,
          plainProxyLatency,
          shallotLatency,
          directThroughput,
          plainProxyThroughput,
          shallotThroughput,
        ]) {
          if (measurement.successRate !== 1) {
            throw new Error(`benchmark success rate was ${measurement.successRate}`);
          }
        }
        results.push({
          payloadBytes: Buffer.byteLength(body),
          throughputRequests: throughputRequestCount,
          directLatency,
          plainProxyLatency,
          shallotLatency,
          directThroughput,
          plainProxyThroughput,
          shallotThroughput,
        });
      }

      const elapsedSeconds = (Bun.nanoseconds() - startedAt) / 1_000_000_000;
      console.log(
        formatReport(results, {
          latencyRequests,
          throughputRequests,
          concurrency,
          elapsedSeconds,
        }),
      );
    } finally {
      await stack.stop();
    }
  } finally {
    await rm(payloadDirectory, { recursive: true });
  }
}

await main();

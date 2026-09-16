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
  const values = (process.env.BENCH_PAYLOAD_BYTES ?? "256,4096,32768")
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
  const concurrency = positiveInteger("BENCH_CONCURRENCY", 32);
  const warmupRequests = positiveInteger("BENCH_WARMUP_REQUESTS", 50);
  const oha = await requireOha();
  const stack = await startBenchmarkStack();
  const startedAt = Bun.nanoseconds();

  try {
    const warmupBody = requestBody(4_096);
    await runOha(oha, {
      url: stack.directUrl,
      authorization: stack.directAuthorization,
      body: warmupBody,
      requests: warmupRequests,
      concurrency: 4,
      quiet: true,
    });
    await runOha(oha, {
      url: stack.shallotUrl,
      authorization: stack.shallotAuthorization,
      body: warmupBody,
      requests: warmupRequests,
      concurrency: 4,
      quiet: true,
    });

    const results: BenchmarkResult[] = [];
    for (const targetBytes of payloadSizes()) {
      const body = requestBody(targetBytes);
      const directLatency = await runOha(oha, {
        url: stack.directUrl,
        authorization: stack.directAuthorization,
        body,
        requests: latencyRequests,
        concurrency: 1,
      });
      const shallotLatency = await runOha(oha, {
        url: stack.shallotUrl,
        authorization: stack.shallotAuthorization,
        body,
        requests: latencyRequests,
        concurrency: 1,
      });
      const directThroughput = await runOha(oha, {
        url: stack.directUrl,
        authorization: stack.directAuthorization,
        body,
        requests: throughputRequests,
        concurrency,
      });
      const shallotThroughput = await runOha(oha, {
        url: stack.shallotUrl,
        authorization: stack.shallotAuthorization,
        body,
        requests: throughputRequests,
        concurrency,
      });

      for (const measurement of [
        directLatency,
        shallotLatency,
        directThroughput,
        shallotThroughput,
      ]) {
        if (measurement.successRate !== 1) {
          throw new Error(`benchmark success rate was ${measurement.successRate}`);
        }
      }
      results.push({
        payloadBytes: Buffer.byteLength(body),
        directLatency,
        shallotLatency,
        directThroughput,
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
}

await main();

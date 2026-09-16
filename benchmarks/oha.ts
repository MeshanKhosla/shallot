export interface OhaMetrics {
  successRate: number;
  requestsPerSecond: number;
  latencyMs: {
    mean: number;
    p50: number;
    p95: number;
    p99: number;
  };
}

interface OhaOutput {
  metrics: {
    success_rate: number;
    requests_per_sec: number;
    latency_ms: {
      mean: number;
      p50: number;
      p95: number;
      p99: number;
    };
  };
}

export interface OhaRun {
  url: string;
  authorization: string;
  bodyPath: string;
  requests: number;
  concurrency: number;
  quiet?: boolean;
}

export async function requireOha(): Promise<string> {
  const lookup = Bun.spawnSync({ cmd: ["sh", "-c", "command -v oha"] });
  if (lookup.exitCode !== 0) {
    throw new Error(
      "oha is required for HTTP benchmarks; install it with `brew install oha` or its package for your platform",
    );
  }
  return lookup.stdout.toString().trim();
}

export async function runOha(ohaPath: string, run: OhaRun): Promise<OhaMetrics> {
  const command = [
    ohaPath,
    "--no-tui",
    "--output-format",
    run.quiet ? "quiet" : "json",
    "--method",
    "POST",
    "-n",
    String(run.requests),
    "-c",
    String(run.concurrency),
    "-t",
    "10s",
    "-H",
    `Authorization: ${run.authorization}`,
    "-T",
    "application/json",
    "-D",
    run.bodyPath,
    run.url,
  ];
  const process = Bun.spawn({
    cmd: command,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`oha failed with status ${exitCode}: ${stderr.trim()}`);
  }
  if (run.quiet) {
    return {
      successRate: 1,
      requestsPerSecond: 0,
      latencyMs: { mean: 0, p50: 0, p95: 0, p99: 0 },
    };
  }

  const output = JSON.parse(stdout) as OhaOutput;
  return {
    successRate: output.metrics.success_rate,
    requestsPerSecond: output.metrics.requests_per_sec,
    latencyMs: output.metrics.latency_ms,
  };
}

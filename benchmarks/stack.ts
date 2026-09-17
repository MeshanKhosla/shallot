import { generateKeyPairSync } from "node:crypto";
import { resolve } from "node:path";

const TENANT_TOKEN = "benchmark-tenant-token";
const RELAY_TOKEN = "benchmark-relay-token";
const PROVIDER_TOKEN = "benchmark-provider-token";

export interface BenchmarkStack {
  directUrl: string;
  plainProxyUrl: string;
  shallotUrl: string;
  directAuthorization: string;
  plainProxyAuthorization: string;
  shallotAuthorization: string;
  stop(): Promise<void>;
}

interface Service {
  name: string;
  process: Bun.Subprocess;
  url: string;
}

function benchmarkPort(offset: number): number {
  const base = Number(process.env.BENCH_BASE_PORT ?? 18_885);
  if (!Number.isSafeInteger(base) || base < 1024 || base + 4 > 65_535) {
    throw new Error("BENCH_BASE_PORT must leave five valid non-privileged ports");
  }
  return base + offset;
}

function spawnService(
  root: string,
  name: string,
  entrypoint: string,
  url: string,
  environment: Record<string, string>,
): Service {
  return {
    name,
    url,
    process: Bun.spawn({
      cmd: [process.execPath, resolve(root, entrypoint)],
      cwd: root,
      env: { ...process.env, ...environment },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "inherit",
    }),
  };
}

async function waitUntilListening(service: Service): Promise<void> {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    if (service.process.exitCode !== null) {
      throw new Error(`${service.name} exited before accepting connections`);
    }
    try {
      await fetch(service.url);
      return;
    } catch {
      await Bun.sleep(20);
    }
  }
  throw new Error(`${service.name} did not start within 10 seconds`);
}

async function stopService(service: Service): Promise<void> {
  if (service.process.exitCode !== null) return;
  service.process.kill("SIGTERM");
  const exited = await Promise.race([
    service.process.exited.then(() => true),
    Bun.sleep(1_000).then(() => false),
  ]);
  if (!exited) {
    service.process.kill("SIGKILL");
    await service.process.exited;
  }
}

export async function startBenchmarkStack(): Promise<BenchmarkStack> {
  const root = resolve(import.meta.dir, "..");
  const providerPort = benchmarkPort(0);
  const exitPort = benchmarkPort(1);
  const relayPort = benchmarkPort(2);
  const sidecarPort = benchmarkPort(3);
  const plainProxyPort = benchmarkPort(4);
  const providerUrl = `http://127.0.0.1:${providerPort}/v1/chat/completions`;
  const exitUrl = `http://127.0.0.1:${exitPort}/v1/chat/completions`;
  const relayUrl = `http://127.0.0.1:${relayPort}/v1/chat/completions`;
  const sidecarUrl = `http://127.0.0.1:${sidecarPort}/v1/chat/completions`;
  const plainProxyUrl = `http://127.0.0.1:${plainProxyPort}/v1/chat/completions`;
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  const privateKeyValue = privateKey
    .export({ format: "der", type: "pkcs8" })
    .toString("base64url");
  const publicKeyValue = publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64url");

  const services: Service[] = [];
  try {
    const provider = spawnService(
      root,
      "mock provider",
      "packages/mock-provider/src/main.ts",
      providerUrl,
      {
        MOCK_PROVIDER_PORT: String(providerPort),
        MOCK_PROVIDER_API_KEY: PROVIDER_TOKEN,
        MOCK_PROVIDER_CHUNK_DELAY_MS: "0",
      },
    );
    services.push(provider);
    await waitUntilListening(provider);

    const plainProxy = spawnService(
      root,
      "plain proxy",
      "benchmarks/plain-proxy.ts",
      plainProxyUrl,
      {
        BENCH_PROXY_PORT: String(plainProxyPort),
        BENCH_PROXY_PROVIDER_URL: providerUrl,
        BENCH_PROXY_TENANT_TOKEN: TENANT_TOKEN,
        BENCH_PROXY_PROVIDER_TOKEN: PROVIDER_TOKEN,
      },
    );
    services.push(plainProxy);
    await waitUntilListening(plainProxy);

    const exit = spawnService(root, "Exit", "packages/exit/src/main.ts", exitUrl, {
      EXIT_PORT: String(exitPort),
      EXIT_PRIVATE_KEY: privateKeyValue,
      EXIT_KEY_ID: "benchmark",
      EXIT_RELAY_TOKEN: RELAY_TOKEN,
      LLM_PROVIDER_URL: providerUrl,
      LLM_PROVIDER_API_KEY: PROVIDER_TOKEN,
      LLM_ALLOWED_MODELS: "mock-text",
      EXIT_RESPONSE_PADDING_BYTES: "512",
      EXIT_RESPONSE_FLUSH_MS: "1",
    });
    services.push(exit);
    await waitUntilListening(exit);

    const relay = spawnService(root, "Relay", "packages/relay/src/main.ts", relayUrl, {
      RELAY_PORT: String(relayPort),
      RELAY_EXIT_URL: exitUrl,
      RELAY_EXIT_TOKEN: RELAY_TOKEN,
      RELAY_TENANT_TOKENS: `benchmark:${TENANT_TOKEN}`,
      RELAY_MAX_CONCURRENT_REQUESTS: "256",
      RELAY_REQUEST_MAX_ENTRIES_PER_TENANT: "100000",
    });
    services.push(relay);
    await waitUntilListening(relay);

    const sidecar = spawnService(
      root,
      "sidecar",
      "packages/client/src/main.ts",
      sidecarUrl,
      {
        SIDECAR_PORT: String(sidecarPort),
        SIDECAR_RELAY_URL: relayUrl,
        SIDECAR_EXIT_PUBLIC_KEY: publicKeyValue,
        SIDECAR_EXIT_KEY_ID: "benchmark",
        SIDECAR_REQUEST_PADDING_BYTES: "4096",
      },
    );
    services.push(sidecar);
    await waitUntilListening(sidecar);

    return {
      directUrl: providerUrl,
      plainProxyUrl,
      shallotUrl: sidecarUrl,
      directAuthorization: `Bearer ${PROVIDER_TOKEN}`,
      plainProxyAuthorization: `Bearer ${TENANT_TOKEN}`,
      shallotAuthorization: `Bearer ${TENANT_TOKEN}`,
      async stop() {
        for (const service of services.reverse()) await stopService(service);
      },
    };
  } catch (error) {
    for (const service of services.reverse()) await stopService(service);
    throw error;
  }
}

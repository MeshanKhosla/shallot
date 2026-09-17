import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateExitKeyFiles } from "./generate-exit-key.ts";

export interface LocalStackKeys {
  privateKey: string;
  publicKey: string;
}

export interface LocalService {
  name: "provider" | "exit" | "relay" | "sidecar";
  entrypoint: string;
  environment: Record<string, string | undefined>;
}

function readKeys(rootDirectory: string): LocalStackKeys {
  const keyDirectory = resolve(rootDirectory, ".shallot/keys");
  const privateKeyPath = resolve(keyDirectory, "exit-private.key");
  const publicKeyPath = resolve(keyDirectory, "exit-public.key");
  const hasPrivateKey = existsSync(privateKeyPath);
  const hasPublicKey = existsSync(publicKeyPath);

  if (hasPrivateKey !== hasPublicKey) {
    throw new Error(
      `incomplete Exit key pair in ${keyDirectory}; remove the remaining key or restore its pair`,
    );
  }
  if (!hasPrivateKey) generateExitKeyFiles(keyDirectory);

  return {
    privateKey: readFileSync(privateKeyPath, "utf8").trim(),
    publicKey: readFileSync(publicKeyPath, "utf8").trim(),
  };
}

export function createLocalServices(
  rootDirectory: string,
  keys: LocalStackKeys,
  environment: NodeJS.ProcessEnv = process.env,
): LocalService[] {
  const providerPort = environment.MOCK_PROVIDER_PORT ?? "8785";
  const exitPort = environment.EXIT_PORT ?? "8786";
  const relayPort = environment.RELAY_PORT ?? "8787";
  const providerToken =
    environment.EXIT_PROVIDER_API_KEY ??
    environment.MOCK_PROVIDER_API_KEY ??
    "provider-local";
  const relayToken =
    environment.EXIT_RELAY_TOKEN ?? environment.RELAY_EXIT_TOKEN ?? "relay-to-exit-local";
  const common = {
    ...environment,
    SHALLOT_LOG_LEVEL: environment.SHALLOT_LOG_LEVEL ?? "debug",
    SHALLOT_LOG_FORMAT: environment.SHALLOT_LOG_FORMAT ?? "pretty",
  };

  return [
    {
      name: "provider",
      entrypoint: resolve(rootDirectory, "packages/mock-provider/src/main.ts"),
      environment: {
        ...common,
        MOCK_PROVIDER_API_KEY: providerToken,
      },
    },
    {
      name: "exit",
      entrypoint: resolve(rootDirectory, "packages/exit/src/main.ts"),
      environment: {
        ...common,
        EXIT_PRIVATE_KEY: keys.privateKey,
        EXIT_RELAY_TOKEN: relayToken,
        EXIT_PROVIDER_API_KEY: providerToken,
        EXIT_PROVIDER_URL:
          environment.EXIT_PROVIDER_URL ??
          `http://127.0.0.1:${providerPort}/v1/chat/completions`,
      },
    },
    {
      name: "relay",
      entrypoint: resolve(rootDirectory, "packages/relay/src/main.ts"),
      environment: {
        ...common,
        RELAY_TENANT_TOKENS: environment.RELAY_TENANT_TOKENS ?? "demo:tenant-local",
        RELAY_EXIT_TOKEN: relayToken,
        RELAY_EXIT_URL:
          environment.RELAY_EXIT_URL ??
          `http://127.0.0.1:${exitPort}/v1/chat/completions`,
      },
    },
    {
      name: "sidecar",
      entrypoint: resolve(rootDirectory, "packages/client/src/main.ts"),
      environment: {
        ...common,
        SIDECAR_EXIT_PUBLIC_KEY: keys.publicKey,
        SIDECAR_RELAY_URL:
          environment.SIDECAR_RELAY_URL ??
          `http://127.0.0.1:${relayPort}/v1/chat/completions`,
      },
    },
  ];
}

async function stopChildren(children: Bun.Subprocess[]): Promise<void> {
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  await Promise.all(children.map((child) => child.exited));
}

export async function runLocalStack(rootDirectory: string): Promise<number> {
  const services = createLocalServices(rootDirectory, readKeys(rootDirectory));
  const children = services.map((service) => {
    console.log(`[local-stack] starting ${service.name}`);
    return Bun.spawn([process.execPath, service.entrypoint], {
      cwd: rootDirectory,
      env: service.environment,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });
  });

  let resolveSignal: (signal: NodeJS.Signals) => void = () => undefined;
  const signalReceived = new Promise<NodeJS.Signals>((resolveSignalPromise) => {
    resolveSignal = resolveSignalPromise;
  });
  const onInterrupt = () => resolveSignal("SIGINT");
  const onTerminate = () => resolveSignal("SIGTERM");
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);

  try {
    const result = await Promise.race([
      signalReceived.then((signal) => ({ type: "signal" as const, signal })),
      ...children.map((child, index) =>
        child.exited.then((exitCode) => ({
          type: "exit" as const,
          exitCode,
          service: services[index]?.name ?? "unknown",
        })),
      ),
    ]);

    if (result.type === "exit") {
      console.error(
        `[local-stack] ${result.service} exited with code ${result.exitCode}`,
      );
    }
    await stopChildren(children);
    return result.type === "signal" ? 0 : result.exitCode || 1;
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
  }
}

if (import.meta.main) {
  const rootDirectory = resolve(import.meta.dir, "..");
  process.exitCode = await runLocalStack(rootDirectory);
}

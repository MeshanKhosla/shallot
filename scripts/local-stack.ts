import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type ConcurrentlyCommandInput, concurrently } from "concurrently";
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

interface LocalStackOptions {
  inspect?: boolean;
}

const INSPECTOR_ENDPOINTS: Record<LocalService["name"], string> = {
  provider: "127.0.0.1:6499/provider",
  exit: "127.0.0.1:6500/exit",
  relay: "127.0.0.1:6501/relay",
  sidecar: "127.0.0.1:6502/sidecar",
};

const SERVICE_COLORS: Record<LocalService["name"], string> = {
  provider: "blue",
  exit: "magenta",
  relay: "yellow",
  sidecar: "cyan",
};

export function createLocalServiceCommand(
  service: LocalService,
  inspect = false,
): string {
  const inspectArgument = inspect
    ? ` --inspect=${INSPECTOR_ENDPOINTS[service.name]}`
    : "";
  return `bun${inspectArgument} ${service.entrypoint}`;
}

export function createConcurrentCommands(
  services: LocalService[],
  inspect = false,
): ConcurrentlyCommandInput[] {
  return services.map((service) => ({
    command: createLocalServiceCommand(service, inspect),
    name: service.name,
    prefixColor: SERVICE_COLORS[service.name],
    env: service.environment,
  }));
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
  };

  return [
    {
      name: "provider",
      entrypoint: "packages/mock-provider/src/main.ts",
      environment: {
        ...common,
        MOCK_PROVIDER_API_KEY: providerToken,
      },
    },
    {
      name: "exit",
      entrypoint: "packages/exit/src/main.ts",
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
      entrypoint: "packages/relay/src/main.ts",
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
      entrypoint: "packages/client/src/main.ts",
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

export async function runLocalStack(
  rootDirectory: string,
  options: LocalStackOptions = {},
): Promise<number> {
  const services = createLocalServices(readKeys(rootDirectory));
  const { result } = concurrently(createConcurrentCommands(services, options.inspect), {
    cwd: rootDirectory,
    prefix: "[{color}{name}{/color}]",
    padPrefix: true,
    killOthersOn: "failure",
    killSignal: "SIGTERM",
    killTimeout: 3_000,
  });

  try {
    await result;
    return 0;
  } catch {
    return 1;
  }
}

if (import.meta.main) {
  const rootDirectory = resolve(import.meta.dir, "..");
  const args = Bun.argv.slice(2);
  if (args.some((argument) => argument !== "--inspect")) {
    throw new Error("usage: bun scripts/local-stack.ts [--inspect]");
  }
  process.exitCode = await runLocalStack(rootDirectory, {
    inspect: args.includes("--inspect"),
  });
}

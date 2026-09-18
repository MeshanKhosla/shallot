import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { ConfigProvider, Effect, Redacted } from "effect";
import { loadConfig } from "../src/config.ts";
import { loadLlmProviderConfig } from "../src/llm-config.ts";

const runConfig = <A, E>(config: Effect.Effect<A, E>) =>
  Effect.runSync(
    config.pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown(process.env),
      ),
    ),
  );
const runExitConfig = () => runConfig(loadConfig);
const runProviderConfig = () => runConfig(loadLlmProviderConfig);

const EXIT_ENV = [
  "EXIT_PRIVATE_KEY",
  "EXIT_RELAY_TOKEN",
  "EXIT_HOSTNAME",
  "EXIT_PORT",
  "EXIT_KEY_ID",
  "EXIT_MAX_ENVELOPE_BYTES",
  "EXIT_RESPONSE_PADDING_BYTES",
  "EXIT_RESPONSE_FLUSH_MS",
  "EXIT_REPLAY_TTL_MS",
  "EXIT_REPLAY_MAX_ENTRIES",
  "LLM_PROVIDER_URL",
  "LLM_PROVIDER_API_KEY",
  "LLM_PROVIDER_TIMEOUT_MS",
  "LLM_ALLOWED_MODELS",
  "LLM_MAX_RESPONSE_BYTES",
] as const;

const original: Record<string, string | undefined> = {};

function privateKeyPem(): string {
  return generateKeyPairSync("x25519")
    .privateKey.export({ format: "pem", type: "pkcs8" })
    .toString();
}

beforeEach(() => {
  for (const name of EXIT_ENV) {
    original[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of EXIT_ENV) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
});

describe("Exit config", () => {
  test("requires a private key", () => {
    process.env.EXIT_RELAY_TOKEN = "relay-token";
    expect(runExitConfig).toThrow("EXIT_PRIVATE_KEY");
  });

  test("requires a relay token", () => {
    process.env.EXIT_PRIVATE_KEY = privateKeyPem();
    expect(runExitConfig).toThrow("EXIT_RELAY_TOKEN");
  });

  test("rejects an invalid port", () => {
    process.env.EXIT_PRIVATE_KEY = privateKeyPem();
    process.env.EXIT_RELAY_TOKEN = "relay-token";
    process.env.EXIT_PORT = "0";
    expect(runExitConfig).toThrow();
  });

  test("rejects an invalid private key as a config error", () => {
    process.env.EXIT_PRIVATE_KEY = "not-a-key";
    process.env.EXIT_RELAY_TOKEN = "relay-token";
    expect(runExitConfig).toThrow("EXIT_PRIVATE_KEY must be a valid X25519 private key");
  });

  test("loads a full configuration", () => {
    process.env.EXIT_PRIVATE_KEY = privateKeyPem();
    process.env.EXIT_RELAY_TOKEN = "relay-token";
    process.env.EXIT_HOSTNAME = "exit.internal";
    process.env.EXIT_PORT = "9900";
    process.env.EXIT_KEY_ID = "rotated-key";
    process.env.EXIT_REPLAY_MAX_ENTRIES = "3";

    const config = runExitConfig();

    expect(config.hostname).toBe("exit.internal");
    expect(config.port).toBe(9900);
    expect(Redacted.value(config.relayToken)).toBe("relay-token");
    expect(config.privateKeys.has("rotated-key")).toBeTrue();
    expect(config.privateKeys.size).toBe(1);
    expect(config.replayMaxEntries).toBe(3);
    expect(config.responsePaddingBytes).toBe(4096);
  });

  test("defaults to the local key id and port", () => {
    process.env.EXIT_PRIVATE_KEY = privateKeyPem();
    process.env.EXIT_RELAY_TOKEN = "relay-token";

    const config = runExitConfig();

    expect(config.port).toBe(8786);
    expect(config.hostname).toBe("127.0.0.1");
    expect(config.privateKeys.has("local")).toBeTrue();
  });
});

describe("LLM provider config", () => {
  test("requires a provider URL", () => {
    expect(runProviderConfig).toThrow("LLM_PROVIDER_URL");
  });

  test("rejects invalid limits", () => {
    process.env.LLM_PROVIDER_URL = "https://provider.example/v1/chat/completions";
    process.env.LLM_PROVIDER_TIMEOUT_MS = "0";
    expect(runProviderConfig).toThrow();

    delete process.env.LLM_PROVIDER_TIMEOUT_MS;
    process.env.LLM_MAX_RESPONSE_BYTES = "1.5";
    expect(runProviderConfig).toThrow();
  });

  test("loads provider credentials, policy, and defaults", () => {
    process.env.LLM_PROVIDER_URL = "https://provider.example/v1/chat/completions";
    process.env.LLM_PROVIDER_API_KEY = "provider-token";
    process.env.LLM_ALLOWED_MODELS = "model-one, model-two";

    const config = runProviderConfig();

    expect(config.url).toEqual(new URL("https://provider.example/v1/chat/completions"));
    if (config.apiKey === undefined) throw new Error("expected a provider API key");
    expect(Redacted.value(config.apiKey)).toBe("provider-token");
    expect(config.timeoutMs).toBe(60_000);
    expect(config.policy.allowedModels).toEqual(new Set(["model-one", "model-two"]));
    expect(config.policy.maxResponseBytes).toBe(16 * 1024 * 1024);
  });
});

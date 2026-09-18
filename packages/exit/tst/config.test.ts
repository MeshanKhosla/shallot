import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { ConfigProvider, Effect, Redacted } from "effect";
import { loadConfig } from "../src/config.ts";
import { loadLlmProviderConfig } from "../src/llm-config.ts";

function runConfig<A, E>(
  config: Effect.Effect<A, E>,
  env: Record<string, string> = {},
): A {
  return Effect.runSync(
    config.pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown(env),
      ),
    ),
  );
}

const runExitConfig = (env: Record<string, string> = {}) => runConfig(loadConfig, env);
const runProviderConfig = (env: Record<string, string> = {}) =>
  runConfig(loadLlmProviderConfig, env);

function privateKeyPem(): string {
  return generateKeyPairSync("x25519")
    .privateKey.export({ format: "pem", type: "pkcs8" })
    .toString();
}

describe("Exit config", () => {
  test("requires a private key", () => {
    expect(() => runExitConfig({ EXIT_RELAY_TOKEN: "relay-token" })).toThrow(
      "EXIT_PRIVATE_KEY",
    );
  });

  test("requires a relay token", () => {
    expect(() => runExitConfig({ EXIT_PRIVATE_KEY: privateKeyPem() })).toThrow(
      "EXIT_RELAY_TOKEN",
    );
  });

  test("rejects an invalid port", () => {
    expect(() =>
      runExitConfig({
        EXIT_PRIVATE_KEY: privateKeyPem(),
        EXIT_RELAY_TOKEN: "relay-token",
        EXIT_PORT: "0",
      }),
    ).toThrow();
  });

  test("rejects an invalid private key as a config error", () => {
    expect(() =>
      runExitConfig({
        EXIT_PRIVATE_KEY: "not-a-key",
        EXIT_RELAY_TOKEN: "relay-token",
      }),
    ).toThrow("EXIT_PRIVATE_KEY must be a valid X25519 private key");
  });

  test("loads a full configuration", () => {
    const config = runExitConfig({
      EXIT_PRIVATE_KEY: privateKeyPem(),
      EXIT_RELAY_TOKEN: "relay-token",
      EXIT_HOSTNAME: "exit.internal",
      EXIT_PORT: "9900",
      EXIT_KEY_ID: "rotated-key",
      EXIT_REPLAY_MAX_ENTRIES: "3",
    });

    expect(config.hostname).toBe("exit.internal");
    expect(config.port).toBe(9900);
    expect(Redacted.value(config.relayToken)).toBe("relay-token");
    expect(config.privateKeys.has("rotated-key")).toBeTrue();
    expect(config.privateKeys.size).toBe(1);
    expect(config.replayMaxEntries).toBe(3);
    expect(config.responsePaddingBytes).toBe(4096);
  });

  test("defaults to the local key id and port", () => {
    const config = runExitConfig({
      EXIT_PRIVATE_KEY: privateKeyPem(),
      EXIT_RELAY_TOKEN: "relay-token",
    });

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
    expect(() =>
      runProviderConfig({
        LLM_PROVIDER_URL: "https://provider.example/v1/chat/completions",
        LLM_PROVIDER_TIMEOUT_MS: "0",
      }),
    ).toThrow();
    expect(() =>
      runProviderConfig({
        LLM_PROVIDER_URL: "https://provider.example/v1/chat/completions",
        LLM_MAX_RESPONSE_BYTES: "1.5",
      }),
    ).toThrow();
  });

  test("loads provider credentials, policy, and defaults", () => {
    const config = runProviderConfig({
      LLM_PROVIDER_URL: "https://provider.example/v1/chat/completions",
      LLM_PROVIDER_API_KEY: "provider-token",
      LLM_ALLOWED_MODELS: "model-one, model-two",
    });

    expect(config.url).toEqual(new URL("https://provider.example/v1/chat/completions"));
    if (config.apiKey === undefined) throw new Error("expected a provider API key");
    expect(Redacted.value(config.apiKey)).toBe("provider-token");
    expect(config.timeoutMs).toBe(60_000);
    expect(config.policy.allowedModels).toEqual(new Set(["model-one", "model-two"]));
    expect(config.policy.maxResponseBytes).toBe(16 * 1024 * 1024);
  });
});

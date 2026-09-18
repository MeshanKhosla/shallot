import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ConfigProvider, Effect, Redacted } from "effect";
import { loadConfig } from "../src/config.ts";

const runConfig = () =>
  Effect.runSync(
    loadConfig.pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown(process.env),
      ),
    ),
  );

const MOCK_PROVIDER_ENV = [
  "MOCK_PROVIDER_HOSTNAME",
  "MOCK_PROVIDER_PORT",
  "MOCK_PROVIDER_API_KEY",
  "MOCK_PROVIDER_CHUNK_DELAY_MS",
] as const;

const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of MOCK_PROVIDER_ENV) {
    original[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of MOCK_PROVIDER_ENV) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
});

describe("Mock provider config", () => {
  test("rejects a negative integer", () => {
    process.env.MOCK_PROVIDER_PORT = "-1";
    expect(runConfig).toThrow();
  });

  test("loads a full configuration", () => {
    process.env.MOCK_PROVIDER_HOSTNAME = "provider.internal";
    process.env.MOCK_PROVIDER_PORT = "9200";
    process.env.MOCK_PROVIDER_API_KEY = "api-key";
    process.env.MOCK_PROVIDER_CHUNK_DELAY_MS = "15";

    const config = runConfig();

    expect(config.hostname).toBe("provider.internal");
    expect(config.port).toBe(9200);
    if (config.expectedApiKey === undefined) throw new Error("expected an API key");
    expect(Redacted.value(config.expectedApiKey)).toBe("api-key");
    expect(config.chunkDelayMs).toBe(15);
  });

  test("applies defaults and allows port zero", () => {
    process.env.MOCK_PROVIDER_PORT = "0";

    const config = runConfig();

    expect(config.port).toBe(0);
    expect(config.hostname).toBe("127.0.0.1");
    expect(config.expectedApiKey).toBeUndefined();
    expect(config.chunkDelayMs).toBe(1);
  });
});

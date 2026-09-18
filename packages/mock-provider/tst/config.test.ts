import { describe, expect, test } from "bun:test";
import { ConfigProvider, Effect, Redacted } from "effect";
import { loadConfig } from "../src/config.ts";

function runConfig(env: Record<string, string> = {}) {
  return Effect.runSync(
    loadConfig.pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown(env),
      ),
    ),
  );
}

describe("Mock provider config", () => {
  test("rejects a negative integer", () => {
    expect(() => runConfig({ MOCK_PROVIDER_PORT: "-1" })).toThrow();
  });

  test("loads a full configuration", () => {
    const config = runConfig({
      MOCK_PROVIDER_HOSTNAME: "provider.internal",
      MOCK_PROVIDER_PORT: "9200",
      MOCK_PROVIDER_API_KEY: "api-key",
      MOCK_PROVIDER_CHUNK_DELAY_MS: "15",
    });

    expect(config.hostname).toBe("provider.internal");
    expect(config.port).toBe(9200);
    if (config.expectedApiKey === undefined) throw new Error("expected an API key");
    expect(Redacted.value(config.expectedApiKey)).toBe("api-key");
    expect(config.chunkDelayMs).toBe(15);
  });

  test("applies defaults and allows port zero", () => {
    const config = runConfig({ MOCK_PROVIDER_PORT: "0" });

    expect(config.port).toBe(0);
    expect(config.hostname).toBe("127.0.0.1");
    expect(config.expectedApiKey).toBeUndefined();
    expect(config.chunkDelayMs).toBe(1);
  });
});

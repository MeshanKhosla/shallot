import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.ts";

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
  test("regects a negative integer", () => {
    process.env.MOCK_PROVIDER_PORT = "-1";
    expect(() => loadConfig()).toThrow(
      "MOCK_PROVIDER_PORT must be a non-negative integer",
    );
  });

  test("loads a full configuration", () => {
    process.env.MOCK_PROVIDER_HOSTNAME = "provider.internal";
    process.env.MOCK_PROVIDER_PORT = "9200";
    process.env.MOCK_PROVIDER_API_KEY = "api-key";
    process.env.MOCK_PROVIDER_CHUNK_DELAY_MS = "15";

    const config = loadConfig();

    expect(config.hostname).toBe("provider.internal");
    expect(config.port).toBe(9200);
    expect(config.expectedApiKey).toBe("api-key");
    expect(config.chunkDelayMs).toBe(15);
  });

  test("applies defaults and allows port zero", () => {
    process.env.MOCK_PROVIDER_PORT = "0";

    const config = loadConfig();

    expect(config.port).toBe(0);
    expect(config.hostname).toBe("127.0.0.1");
    expect(config.expectedApiKey).toBeUndefined();
    expect(config.chunkDelayMs).toBe(1);
  });
});

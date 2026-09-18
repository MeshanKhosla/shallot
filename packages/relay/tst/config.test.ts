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

const RELAY_ENV = [
  "RELAY_EXIT_TOKEN",
  "RELAY_HOSTNAME",
  "RELAY_PORT",
  "RELAY_EXIT_URL",
  "RELAY_TENANT_TOKENS",
  "RELAY_REQUEST_TTL_MS",
  "RELAY_REQUEST_MAX_ENTRIES",
  "RELAY_REQUEST_MAX_ENTRIES_PER_TENANT",
  "RELAY_MAX_ENVELOPE_BYTES",
  "RELAY_MAX_CONCURRENT_REQUESTS",
  "RELAY_EXIT_TIMEOUT_MS",
] as const;

const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of RELAY_ENV) {
    original[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of RELAY_ENV) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
});

describe("Relay config", () => {
  test("requires an exit token", () => {
    expect(runConfig).toThrow("RELAY_TENANT_TOKENS");
  });

  test("requires tenant tokens", () => {
    process.env.RELAY_EXIT_TOKEN = "exit-token";
    expect(runConfig).toThrow("RELAY_TENANT_TOKENS");
  });

  test("rejects malformed tenant token entries", () => {
    process.env.RELAY_EXIT_TOKEN = "exit-token";
    process.env.RELAY_TENANT_TOKENS = "tenant-one";
    expect(runConfig).toThrow("RELAY_TENANT_TOKENS must use tenant:token entries");

    process.env.RELAY_TENANT_TOKENS = ":token";
    expect(runConfig).toThrow("RELAY_TENANT_TOKENS must use tenant:token entries");

    process.env.RELAY_TENANT_TOKENS = "tenant-one:";
    expect(runConfig).toThrow("RELAY_TENANT_TOKENS must use tenant:token entries");
  });

  test("rejects invalid integers", () => {
    process.env.RELAY_EXIT_TOKEN = "exit-token";
    process.env.RELAY_TENANT_TOKENS = "tenant-one:token";

    process.env.RELAY_PORT = "0";
    expect(runConfig).toThrow();

    process.env.RELAY_PORT = "-1";
    expect(runConfig).toThrow();

    process.env.RELAY_PORT = "1.5";
    expect(runConfig).toThrow();
  });

  test("loads a full configuration", () => {
    process.env.RELAY_EXIT_TOKEN = "exit-token";
    process.env.RELAY_TENANT_TOKENS = "tenant-one:one,two:two";
    process.env.RELAY_HOSTNAME = "relay.internal";
    process.env.RELAY_PORT = "9000";
    process.env.RELAY_EXIT_URL = "https://exit.internal/v1/chat/completions";
    process.env.RELAY_MAX_CONCURRENT_REQUESTS = "7";

    const config = runConfig();

    expect(config.hostname).toBe("relay.internal");
    expect(config.port).toBe(9000);
    expect(config.exitUrl).toEqual(new URL("https://exit.internal/v1/chat/completions"));
    expect(Redacted.value(config.exitToken)).toBe("exit-token");
    expect(
      [...config.tenantTokens].map(([id, token]) => [id, Redacted.value(token)]),
    ).toEqual([
      ["tenant-one", "one"],
      ["two", "two"],
    ]);
    expect(config.maxConcurrentRequests).toBe(7);
    expect(config.exitTimeoutMs).toBe(65_000);
  });

  test("applies default ports and URLs", () => {
    process.env.RELAY_EXIT_TOKEN = "exit-token";
    process.env.RELAY_TENANT_TOKENS = "tenant-one:one";

    const config = runConfig();

    expect(config.port).toBe(8787);
    expect(config.hostname).toBe("127.0.0.1");
    expect(config.exitUrl).toEqual(new URL("http://127.0.0.1:8786/v1/chat/completions"));
  });
});

import { describe, expect, test } from "bun:test";
import { ConfigProvider, Effect, Redacted } from "effect";
import { loadConfig } from "../src/config.ts";

const runConfig = (env: Record<string, string> = {}) =>
  Effect.runSync(
    loadConfig.pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown(env),
      ),
    ),
  );

describe("Relay config", () => {
  test("requires an exit token", () => {
    expect(runConfig).toThrow("RELAY_TENANT_TOKENS");
  });

  test("requires tenant tokens", () => {
    expect(() => runConfig({ RELAY_EXIT_TOKEN: "exit-token" })).toThrow(
      "RELAY_TENANT_TOKENS",
    );
  });

  test("rejects malformed tenant token entries", () => {
    for (const tokens of ["tenant-one", ":token", "tenant-one:"]) {
      expect(() =>
        runConfig({
          RELAY_EXIT_TOKEN: "exit-token",
          RELAY_TENANT_TOKENS: tokens,
        }),
      ).toThrow("RELAY_TENANT_TOKENS must use tenant:token entries");
    }
  });

  test("rejects invalid integers", () => {
    for (const port of ["0", "-1", "1.5"]) {
      expect(() =>
        runConfig({
          RELAY_EXIT_TOKEN: "exit-token",
          RELAY_TENANT_TOKENS: "tenant-one:token",
          RELAY_PORT: port,
        }),
      ).toThrow();
    }
  });

  test("loads a full configuration", () => {
    const config = runConfig({
      RELAY_EXIT_TOKEN: "exit-token",
      RELAY_TENANT_TOKENS: "tenant-one:one,two:two",
      RELAY_HOSTNAME: "relay.internal",
      RELAY_PORT: "9000",
      RELAY_EXIT_URL: "https://exit.internal/v1/chat/completions",
      RELAY_MAX_CONCURRENT_REQUESTS: "7",
    });

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
    const config = runConfig({
      RELAY_EXIT_TOKEN: "exit-token",
      RELAY_TENANT_TOKENS: "tenant-one:one",
    });

    expect(config.port).toBe(8787);
    expect(config.hostname).toBe("127.0.0.1");
    expect(config.exitUrl).toEqual(new URL("http://127.0.0.1:8786/v1/chat/completions"));
  });
});

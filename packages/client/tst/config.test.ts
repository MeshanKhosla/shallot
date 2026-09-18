import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { ConfigProvider, Effect } from "effect";
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

function publicKeyPem(): string {
  return generateKeyPairSync("x25519")
    .publicKey.export({ format: "pem", type: "spki" })
    .toString();
}

describe("Sidecar config", () => {
  test("requires an exit public key", () => {
    expect(runConfig).toThrow("SIDECAR_EXIT_PUBLIC_KEY");
  });

  test("rejects an invalid port", () => {
    expect(() =>
      runConfig({ SIDECAR_EXIT_PUBLIC_KEY: publicKeyPem(), SIDECAR_PORT: "-2" }),
    ).toThrow();
  });

  test("rejects an invalid exit public key as a config error", () => {
    expect(() => runConfig({ SIDECAR_EXIT_PUBLIC_KEY: "not-a-key" })).toThrow(
      "SIDECAR_EXIT_PUBLIC_KEY must be a valid X25519 public key",
    );
  });

  test("loads a full configuration", () => {
    const config = runConfig({
      SIDECAR_EXIT_PUBLIC_KEY: publicKeyPem(),
      SIDECAR_RELAY_URL: "https://relay.internal/v1/chat/completions",
      SIDECAR_HOSTNAME: "127.0.0.9",
      SIDECAR_PORT: "9100",
      SIDECAR_EXIT_KEY_ID: "rotated",
      SIDECAR_MAX_RESPONSE_FRAMES: "42",
    });

    expect(config.hostname).toBe("127.0.0.9");
    expect(config.port).toBe(9100);
    expect(config.relayUrl).toEqual(
      new URL("https://relay.internal/v1/chat/completions"),
    );
    expect(config.exitKeyId).toBe("rotated");
    expect(config.maxResponseFrames).toBe(42);
    expect(config.maxResponseBytes).toBe(16 * 1024 * 1024);
  });

  test("parses a PEM exit public key and applies defaults", () => {
    const config = runConfig({ SIDECAR_EXIT_PUBLIC_KEY: publicKeyPem() });

    expect(config.exitKeyId).toBe("local");
    expect(config.port).toBe(8788);
    expect(config.hostname).toBe("127.0.0.1");
    expect(config.relayUrl).toEqual(new URL("http://127.0.0.1:8787/v1/chat/completions"));
    expect(config.exitPublicKey).toBeDefined();
  });
});

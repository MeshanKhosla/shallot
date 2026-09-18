import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { ConfigProvider, Effect } from "effect";
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

const SIDECAR_ENV = [
  "SIDECAR_EXIT_PUBLIC_KEY",
  "SIDECAR_RELAY_URL",
  "SIDECAR_HOSTNAME",
  "SIDECAR_PORT",
  "SIDECAR_EXIT_KEY_ID",
  "SIDECAR_REQUEST_PADDING_BYTES",
  "SIDECAR_MAX_REQUEST_BYTES",
  "SIDECAR_RELAY_TIMEOUT_MS",
  "SIDECAR_MAX_RESPONSE_LINE_BYTES",
  "SIDECAR_MAX_RESPONSE_FRAMES",
  "SIDECAR_MAX_RESPONSE_BYTES",
] as const;

const original: Record<string, string | undefined> = {};

function publicKeyPem(): string {
  return generateKeyPairSync("x25519")
    .publicKey.export({ format: "pem", type: "spki" })
    .toString();
}

beforeEach(() => {
  for (const name of SIDECAR_ENV) {
    original[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of SIDECAR_ENV) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
});

describe("Sidecar config", () => {
  test("requires an exit public key", () => {
    expect(runConfig).toThrow("SIDECAR_EXIT_PUBLIC_KEY");
  });

  test("rejects an invalid port", () => {
    process.env.SIDECAR_EXIT_PUBLIC_KEY = publicKeyPem();
    process.env.SIDECAR_PORT = "-2";
    expect(runConfig).toThrow();
  });

  test("loads a full configuration", () => {
    process.env.SIDECAR_EXIT_PUBLIC_KEY = publicKeyPem();
    process.env.SIDECAR_RELAY_URL = "https://relay.internal/v1/chat/completions";
    process.env.SIDECAR_HOSTNAME = "127.0.0.9";
    process.env.SIDECAR_PORT = "9100";
    process.env.SIDECAR_EXIT_KEY_ID = "rotated";
    process.env.SIDECAR_MAX_RESPONSE_FRAMES = "42";

    const config = runConfig();

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
    process.env.SIDECAR_EXIT_PUBLIC_KEY = publicKeyPem();

    const config = runConfig();

    expect(config.exitKeyId).toBe("local");
    expect(config.port).toBe(8788);
    expect(config.hostname).toBe("127.0.0.1");
    expect(config.relayUrl).toEqual(new URL("http://127.0.0.1:8787/v1/chat/completions"));
    expect(config.exitPublicKey).toBeDefined();
  });
});

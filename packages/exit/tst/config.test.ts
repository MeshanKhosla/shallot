import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { loadConfig } from "../src/config.ts";

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
    expect(() => loadConfig()).toThrow("EXIT_PRIVATE_KEY is required");
  });

  test("requires a relay token", () => {
    process.env.EXIT_PRIVATE_KEY = privateKeyPem();
    expect(() => loadConfig()).toThrow("EXIT_RELAY_TOKEN is required");
  });

  test("rejects an invalid port", () => {
    process.env.EXIT_PRIVATE_KEY = privateKeyPem();
    process.env.EXIT_RELAY_TOKEN = "relay-token";
    process.env.EXIT_PORT = "0";
    expect(() => loadConfig()).toThrow("EXIT_PORT must be a positive integer");
  });

  test("loads a full configuration", () => {
    process.env.EXIT_PRIVATE_KEY = privateKeyPem();
    process.env.EXIT_RELAY_TOKEN = "relay-token";
    process.env.EXIT_HOSTNAME = "exit.internal";
    process.env.EXIT_PORT = "9900";
    process.env.EXIT_KEY_ID = "rotated-key";
    process.env.EXIT_REPLAY_MAX_ENTRIES = "3";

    const config = loadConfig();

    expect(config.hostname).toBe("exit.internal");
    expect(config.port).toBe(9900);
    expect(config.relayToken).toBe("relay-token");
    expect(config.privateKeys.has("rotated-key")).toBeTrue();
    expect(config.privateKeys.size).toBe(1);
    expect(config.replayMaxEntries).toBe(3);
    expect(config.responsePaddingBytes).toBe(4096);
  });

  test("defaults to the local key id and port", () => {
    process.env.EXIT_PRIVATE_KEY = privateKeyPem();
    process.env.EXIT_RELAY_TOKEN = "relay-token";

    const config = loadConfig();

    expect(config.port).toBe(8786);
    expect(config.hostname).toBe("127.0.0.1");
    expect(config.privateKeys.has("local")).toBeTrue();
  });
});

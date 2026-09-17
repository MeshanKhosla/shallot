import type { KeyObject } from "node:crypto";
import { parseX25519PrivateKey } from "@shallot/protocol";
import { loadLlmConfig } from "./llm-config.ts";
import type { LlmConfig } from "./llm-provider.ts";

export interface ExitConfig {
  hostname: string;
  port: number;
  relayToken: string;
  privateKeys: ReadonlyMap<string, KeyObject>;
  llm: LlmConfig;
  maxEnvelopeBytes: number;
  responsePaddingBytes: number;
  responseFlushMs: number;
  replayTtlMs: number;
  replayMaxEntries: number;
}

export function loadConfig(): ExitConfig {
  const privateKey = process.env.EXIT_PRIVATE_KEY;
  const relayToken = process.env.EXIT_RELAY_TOKEN;
  if (!privateKey) throw new Error("EXIT_PRIVATE_KEY is required");
  if (!relayToken) throw new Error("EXIT_RELAY_TOKEN is required");

  const keyId = process.env.EXIT_KEY_ID ?? "local";

  return {
    hostname: process.env.EXIT_HOSTNAME ?? "127.0.0.1",
    port: positiveInteger("EXIT_PORT", 8786),
    relayToken,
    privateKeys: new Map([[keyId, parseX25519PrivateKey(privateKey)]]),
    llm: loadLlmConfig(),
    maxEnvelopeBytes: positiveInteger("EXIT_MAX_ENVELOPE_BYTES", 3 * 1024 * 1024),
    responsePaddingBytes: positiveInteger("EXIT_RESPONSE_PADDING_BYTES", 4096),
    responseFlushMs: positiveInteger("EXIT_RESPONSE_FLUSH_MS", 25),
    replayTtlMs: positiveInteger("EXIT_REPLAY_TTL_MS", 5 * 60_000),
    replayMaxEntries: positiveInteger("EXIT_REPLAY_MAX_ENTRIES", 100_000),
  };
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

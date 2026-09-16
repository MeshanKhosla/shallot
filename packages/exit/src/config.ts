import type { KeyObject } from "node:crypto";
import { parseX25519PrivateKey } from "@shallot/protocol";
import { MemoryReplayCache, type ReplayCache } from "./replay-cache.ts";

export interface ExitConfig {
  hostname: string;
  port: number;
  relayToken: string;
  privateKeys: ReadonlyMap<string, KeyObject>;
  providerUrl: URL;
  providerApiKey?: string;
  allowedModels?: ReadonlySet<string>;
  maxEnvelopeBytes: number;
  responsePaddingBytes: number;
  responseFlushMs: number;
  maxProviderResponseBytes: number;
  providerTimeoutMs: number;
  replayCache: ReplayCache;
  fetch: typeof fetch;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function loadConfig(): ExitConfig {
  const privateKey = process.env.EXIT_PRIVATE_KEY;
  const relayToken = process.env.EXIT_RELAY_TOKEN;
  if (!privateKey) throw new Error("EXIT_PRIVATE_KEY is required");
  if (!relayToken) throw new Error("EXIT_RELAY_TOKEN is required");

  const keyId = process.env.EXIT_KEY_ID ?? "local";
  const allowedModels = process.env.EXIT_ALLOWED_MODELS?.split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return {
    hostname: process.env.EXIT_HOSTNAME ?? "127.0.0.1",
    port: positiveInteger("EXIT_PORT", 8786),
    relayToken,
    privateKeys: new Map([[keyId, parseX25519PrivateKey(privateKey)]]),
    providerUrl: new URL(
      process.env.EXIT_PROVIDER_URL ?? "http://127.0.0.1:8785/v1/chat/completions",
    ),
    providerApiKey: process.env.EXIT_PROVIDER_API_KEY,
    allowedModels: allowedModels ? new Set(allowedModels) : undefined,
    maxEnvelopeBytes: positiveInteger("EXIT_MAX_ENVELOPE_BYTES", 3 * 1024 * 1024),
    responsePaddingBytes: positiveInteger("EXIT_RESPONSE_PADDING_BYTES", 4096),
    responseFlushMs: positiveInteger("EXIT_RESPONSE_FLUSH_MS", 25),
    maxProviderResponseBytes: positiveInteger(
      "EXIT_MAX_PROVIDER_RESPONSE_BYTES",
      16 * 1024 * 1024,
    ),
    providerTimeoutMs: positiveInteger("EXIT_PROVIDER_TIMEOUT_MS", 60_000),
    replayCache: new MemoryReplayCache(
      positiveInteger("EXIT_REPLAY_TTL_MS", 5 * 60_000),
      Date.now,
      positiveInteger("EXIT_REPLAY_MAX_ENTRIES", 100_000),
    ),
    fetch,
  };
}

import { parseX25519PublicKey } from "@shallot/protocol";

export type SidecarFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface SidecarConfig {
  hostname: string;
  port: number;
  relayUrl: URL;
  exitPublicKey: ReturnType<typeof parseX25519PublicKey>;
  exitKeyId: string;
  requestPaddingBytes: number;
  maxRequestBytes: number;
  relayTimeoutMs: number;
  maxResponseLineBytes: number;
  maxResponseFrames: number;
  maxResponseBytes: number;
  fetch?: SidecarFetch;
  relayTimeoutSignal?: (timeoutMs: number) => AbortSignal;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function loadConfig(): SidecarConfig {
  const publicKey = process.env.SIDECAR_EXIT_PUBLIC_KEY;
  if (!publicKey) {
    throw new Error("SIDECAR_EXIT_PUBLIC_KEY is required");
  }

  const relayUrl = new URL(
    process.env.SIDECAR_RELAY_URL ?? "http://127.0.0.1:8787/v1/chat/completions",
  );

  return {
    hostname: process.env.SIDECAR_HOSTNAME ?? "127.0.0.1",
    port: positiveInteger("SIDECAR_PORT", 8788),
    relayUrl,
    exitPublicKey: parseX25519PublicKey(publicKey),
    exitKeyId: process.env.SIDECAR_EXIT_KEY_ID ?? "local",
    requestPaddingBytes: positiveInteger("SIDECAR_REQUEST_PADDING_BYTES", 4096),
    maxRequestBytes: positiveInteger("SIDECAR_MAX_REQUEST_BYTES", 2 * 1024 * 1024),
    relayTimeoutMs: positiveInteger("SIDECAR_RELAY_TIMEOUT_MS", 65_000),
    maxResponseLineBytes: positiveInteger("SIDECAR_MAX_RESPONSE_LINE_BYTES", 64 * 1024),
    maxResponseFrames: positiveInteger("SIDECAR_MAX_RESPONSE_FRAMES", 10_000),
    maxResponseBytes: positiveInteger("SIDECAR_MAX_RESPONSE_BYTES", 16 * 1024 * 1024),
  };
}

import { parseX25519PublicKey } from "@shallot/protocol";

export interface SidecarConfig {
  port: number;
  relayUrl: URL;
  exitPublicKey: ReturnType<typeof parseX25519PublicKey>;
  exitKeyId: string;
  relayAuthorization?: string;
  requestPaddingBytes: number;
  maxRequestBytes: number;
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
    port: positiveInteger("SIDECAR_PORT", 8788),
    relayUrl,
    exitPublicKey: parseX25519PublicKey(publicKey),
    exitKeyId: process.env.SIDECAR_EXIT_KEY_ID ?? "local",
    relayAuthorization: process.env.SIDECAR_RELAY_AUTHORIZATION,
    requestPaddingBytes: positiveInteger("SIDECAR_REQUEST_PADDING_BYTES", 4096),
    maxRequestBytes: positiveInteger("SIDECAR_MAX_REQUEST_BYTES", 2 * 1024 * 1024),
  };
}

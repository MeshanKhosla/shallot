import { parseX25519PublicKey } from "@shallot/protocol";
import { positiveInteger } from "@shallot/server-runtime";
import { Config, Data, Effect } from "effect";

export class SidecarConfigError extends Data.TaggedError("SidecarConfigError")<{
  readonly message: string;
}> {}

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
}

export const loadConfig = Effect.gen(function* () {
  const publicKey = yield* Config.NonEmptyString("SIDECAR_EXIT_PUBLIC_KEY");
  const exitPublicKey = yield* Effect.try({
    try: () => parseX25519PublicKey(publicKey),
    catch: () =>
      new SidecarConfigError({
        message: "SIDECAR_EXIT_PUBLIC_KEY must be a valid X25519 public key",
      }),
  });
  return {
    hostname: yield* Config.String("SIDECAR_HOSTNAME").pipe(
      Config.withDefault("127.0.0.1"),
    ),
    port: yield* Config.Port("SIDECAR_PORT").pipe(Config.withDefault(8788)),
    relayUrl: yield* Config.URL("SIDECAR_RELAY_URL").pipe(
      Config.withDefault(new URL("http://127.0.0.1:8787/v1/chat/completions")),
    ),
    exitPublicKey,
    exitKeyId: yield* Config.String("SIDECAR_EXIT_KEY_ID").pipe(
      Config.withDefault("local"),
    ),
    requestPaddingBytes: yield* positiveInteger("SIDECAR_REQUEST_PADDING_BYTES", 4096),
    maxRequestBytes: yield* positiveInteger("SIDECAR_MAX_REQUEST_BYTES", 2 * 1024 * 1024),
    relayTimeoutMs: yield* positiveInteger("SIDECAR_RELAY_TIMEOUT_MS", 65_000),
    maxResponseLineBytes: yield* positiveInteger(
      "SIDECAR_MAX_RESPONSE_LINE_BYTES",
      64 * 1024,
    ),
    maxResponseFrames: yield* positiveInteger("SIDECAR_MAX_RESPONSE_FRAMES", 10_000),
    maxResponseBytes: yield* positiveInteger(
      "SIDECAR_MAX_RESPONSE_BYTES",
      16 * 1024 * 1024,
    ),
  } satisfies SidecarConfig;
});

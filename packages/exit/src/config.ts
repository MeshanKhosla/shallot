import type { KeyObject } from "node:crypto";
import { parseX25519PrivateKey } from "@shallot/protocol";
import { positiveInteger } from "@shallot/server-runtime";
import { Config, Effect, Redacted } from "effect";

export interface ExitConfig {
  hostname: string;
  port: number;
  relayToken: Redacted.Redacted<string>;
  privateKeys: ReadonlyMap<string, KeyObject>;
  maxEnvelopeBytes: number;
  responsePaddingBytes: number;
  responseFlushMs: number;
  replayTtlMs: number;
  replayMaxEntries: number;
}

export const loadConfig = Effect.gen(function* () {
  const privateKey = yield* Config.Redacted("EXIT_PRIVATE_KEY");
  const keyId = yield* Config.String("EXIT_KEY_ID").pipe(Config.withDefault("local"));
  return {
    hostname: yield* Config.String("EXIT_HOSTNAME").pipe(Config.withDefault("127.0.0.1")),
    port: yield* Config.Port("EXIT_PORT").pipe(Config.withDefault(8786)),
    relayToken: yield* Config.Redacted("EXIT_RELAY_TOKEN"),
    privateKeys: new Map([[keyId, parseX25519PrivateKey(Redacted.value(privateKey))]]),
    maxEnvelopeBytes: yield* positiveInteger("EXIT_MAX_ENVELOPE_BYTES", 3 * 1024 * 1024),
    responsePaddingBytes: yield* positiveInteger("EXIT_RESPONSE_PADDING_BYTES", 4096),
    responseFlushMs: yield* positiveInteger("EXIT_RESPONSE_FLUSH_MS", 25),
    replayTtlMs: yield* positiveInteger("EXIT_REPLAY_TTL_MS", 5 * 60_000),
    replayMaxEntries: yield* positiveInteger("EXIT_REPLAY_MAX_ENTRIES", 100_000),
  } satisfies ExitConfig;
});

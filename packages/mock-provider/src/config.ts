import { nonNegativeInteger } from "@shallot/server-runtime";
import { Config, Effect, Option, type Redacted } from "effect";

export interface ProviderObservation {
  authorization: string | null;
  request: Record<string, unknown>;
}

export interface MockProviderConfig {
  hostname: string;
  port: number;
  expectedApiKey?: Redacted.Redacted<string>;
  chunkDelayMs: number;
}

export const loadConfig = Effect.gen(function* () {
  const expectedApiKey = yield* Config.Redacted("MOCK_PROVIDER_API_KEY").pipe(
    Config.option,
  );
  return {
    hostname: yield* Config.String("MOCK_PROVIDER_HOSTNAME").pipe(
      Config.withDefault("127.0.0.1"),
    ),
    port: yield* nonNegativeInteger("MOCK_PROVIDER_PORT", 8785),
    expectedApiKey: Option.getOrUndefined(expectedApiKey),
    chunkDelayMs: yield* nonNegativeInteger("MOCK_PROVIDER_CHUNK_DELAY_MS", 1),
  } satisfies MockProviderConfig;
});

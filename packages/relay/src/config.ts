import { positiveInteger } from "@shallot/server-runtime";
import { Config, Data, Effect, Redacted } from "effect";

export interface RelayConfig {
  hostname: string;
  port: number;
  exitUrl: URL;
  exitToken: Redacted.Redacted<string>;
  tenantTokens: ReadonlyMap<string, Redacted.Redacted<string>>;
  requestTtlMs: number;
  maxRequestEntries: number;
  maxRequestEntriesPerTenant: number;
  maxEnvelopeBytes: number;
  maxConcurrentRequests: number;
  exitTimeoutMs: number;
}

export class RelayConfigError extends Data.TaggedError("RelayConfigError")<{
  readonly message: string;
}> {}

export const loadConfig = Effect.gen(function* () {
  const configuredTokens = yield* Config.Redacted("RELAY_TENANT_TOKENS");
  return {
    hostname: yield* Config.String("RELAY_HOSTNAME").pipe(
      Config.withDefault("127.0.0.1"),
    ),
    port: yield* Config.Port("RELAY_PORT").pipe(Config.withDefault(8787)),
    exitUrl: yield* Config.URL("RELAY_EXIT_URL").pipe(
      Config.withDefault(new URL("http://127.0.0.1:8786/v1/chat/completions")),
    ),
    exitToken: yield* Config.Redacted("RELAY_EXIT_TOKEN"),
    tenantTokens: yield* parseTenantTokens(configuredTokens),
    requestTtlMs: yield* positiveInteger("RELAY_REQUEST_TTL_MS", 5 * 60_000),
    maxRequestEntries: yield* positiveInteger("RELAY_REQUEST_MAX_ENTRIES", 100_000),
    maxRequestEntriesPerTenant: yield* positiveInteger(
      "RELAY_REQUEST_MAX_ENTRIES_PER_TENANT",
      10_000,
    ),
    maxEnvelopeBytes: yield* positiveInteger("RELAY_MAX_ENVELOPE_BYTES", 3 * 1024 * 1024),
    maxConcurrentRequests: yield* positiveInteger("RELAY_MAX_CONCURRENT_REQUESTS", 100),
    exitTimeoutMs: yield* positiveInteger("RELAY_EXIT_TIMEOUT_MS", 65_000),
  } satisfies RelayConfig;
});

function parseTenantTokens(
  configured: Redacted.Redacted<string>,
): Effect.Effect<Map<string, Redacted.Redacted<string>>, RelayConfigError> {
  const tokens = new Map<string, Redacted.Redacted<string>>();
  const entries = Redacted.value(configured).split(",");
  for (const entry of entries) {
    const separator = entry.indexOf(":");
    if (separator <= 0 || separator === entry.length - 1) {
      return Effect.fail(
        new RelayConfigError({
          message: "RELAY_TENANT_TOKENS must use tenant:token entries",
        }),
      );
    }
    tokens.set(entry.slice(0, separator), Redacted.make(entry.slice(separator + 1)));
  }
  return Effect.succeed(tokens);
}

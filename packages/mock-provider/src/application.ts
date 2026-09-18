import { createDebugLogger } from "@shallot/observability";
import { debugLoggingEnabled } from "@shallot/server-runtime";
import { Effect } from "effect";
import { loadConfig } from "./config.ts";
import { createMockProviderServer } from "./mock-provider.ts";

export const createMockProviderApplication = Effect.gen(function* () {
  const config = yield* loadConfig;
  const debug = yield* debugLoggingEnabled;
  return yield* createMockProviderServer(
    config,
    {},
    {
      logger: createDebugLogger("provider", { enabled: debug }),
    },
  );
});

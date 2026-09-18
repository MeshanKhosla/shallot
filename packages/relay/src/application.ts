import { createDebugLogger } from "@shallot/observability";
import { debugLoggingEnabled } from "@shallot/server-runtime";
import { Effect } from "effect";
import { loadConfig } from "./config.ts";
import { createRelayServer, relayLive } from "./relay.ts";

export const createRelayApplication = Effect.gen(function* () {
  const config = yield* loadConfig;
  const debug = yield* debugLoggingEnabled;
  return createRelayServer(config, relayLive(config), {
    logger: createDebugLogger("relay", { enabled: debug }),
  });
});

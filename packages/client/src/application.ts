import { createDebugLogger } from "@shallot/observability";
import { debugLoggingEnabled } from "@shallot/server-runtime";
import { Effect } from "effect";
import { loadConfig } from "./config.ts";
import { createSidecarServer, sidecarLive } from "./sidecar.ts";

export const createSidecarApplication = Effect.gen(function* () {
  const config = yield* loadConfig;
  const debug = yield* debugLoggingEnabled;
  return yield* createSidecarServer(config, sidecarLive(config), {
    logger: createDebugLogger("sidecar", { enabled: debug }),
  });
});

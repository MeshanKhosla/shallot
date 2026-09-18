import { Effect } from "effect";
import { loadConfig } from "./config.ts";
import { createSidecarServer, sidecarLive } from "./sidecar.ts";

export const createSidecarApplication = Effect.map(loadConfig, (config) =>
  createSidecarServer(config, sidecarLive(config)),
);

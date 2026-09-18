import { Effect } from "effect";
import { loadConfig } from "./config.ts";
import { createRelayServer, relayLive } from "./relay.ts";

export const createRelayApplication = Effect.map(loadConfig, (config) =>
  createRelayServer(config, relayLive(config)),
);

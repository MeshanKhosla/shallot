import { Effect } from "effect";
import { loadConfig } from "./config.ts";
import { createMockProviderServer } from "./mock-provider.ts";

export const createMockProviderApplication = Effect.map(loadConfig, (config) =>
  createMockProviderServer(config),
);

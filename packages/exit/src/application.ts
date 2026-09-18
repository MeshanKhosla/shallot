import { Effect } from "effect";
import { loadConfig } from "./config.ts";
import { createExitServer, exitLive } from "./exit.ts";
import { loadLlmProviderConfig } from "./llm-config.ts";
import { openAICompatibleProviderLive } from "./openai-compatible-provider.ts";

export const createExitApplication = Effect.gen(function* () {
  const config = yield* loadConfig;
  const providerConfig = yield* loadLlmProviderConfig;
  const provider = openAICompatibleProviderLive(providerConfig);
  return createExitServer(config, exitLive(config, provider));
});

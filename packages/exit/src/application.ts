import { loadConfig } from "./config.ts";
import { createExitServer, exitLive } from "./exit.ts";
import { loadLlmProviderConfig } from "./llm-config.ts";
import { openAICompatibleProviderLive } from "./openai-compatible-provider.ts";

export function createExitApplication() {
  const config = loadConfig();
  const provider = openAICompatibleProviderLive(loadLlmProviderConfig());
  return createExitServer(config, exitLive(config, provider));
}

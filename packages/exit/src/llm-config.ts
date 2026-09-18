import { positiveInteger } from "@shallot/server-runtime";
import { Config, Effect, Option } from "effect";
import type { OpenAICompatibleProviderConfig } from "./openai-compatible-provider.ts";

export const loadLlmProviderConfig = Effect.gen(function* () {
  const apiKey = yield* Config.Redacted("LLM_PROVIDER_API_KEY").pipe(Config.option);
  const configuredModels = yield* Config.String("LLM_ALLOWED_MODELS").pipe(Config.option);
  return {
    url: yield* Config.URL("LLM_PROVIDER_URL"),
    apiKey: Option.getOrUndefined(apiKey),
    timeoutMs: yield* positiveInteger("LLM_PROVIDER_TIMEOUT_MS", 60_000),
    policy: {
      allowedModels: Option.match(configuredModels, {
        onNone: () => undefined,
        onSome: (models) =>
          new Set(
            models
              .split(",")
              .map((model) => model.trim())
              .filter(Boolean),
          ),
      }),
      maxResponseBytes: yield* positiveInteger(
        "LLM_MAX_RESPONSE_BYTES",
        16 * 1024 * 1024,
      ),
    },
  } satisfies OpenAICompatibleProviderConfig;
});

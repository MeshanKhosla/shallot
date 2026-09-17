import type { LlmConfig } from "./llm-provider.ts";

export function loadLlmConfig(): LlmConfig {
  const providerUrl = process.env.LLM_PROVIDER_URL;
  if (!providerUrl) throw new Error("LLM_PROVIDER_URL is required");

  const allowedModels = process.env.LLM_ALLOWED_MODELS?.split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return {
    url: new URL(providerUrl),
    apiKey: process.env.LLM_PROVIDER_API_KEY,
    timeoutMs: positiveInteger("LLM_PROVIDER_TIMEOUT_MS", 60_000),
    allowedModels: allowedModels ? new Set(allowedModels) : undefined,
    maxResponseBytes: positiveInteger("LLM_MAX_RESPONSE_BYTES", 16 * 1024 * 1024),
  };
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

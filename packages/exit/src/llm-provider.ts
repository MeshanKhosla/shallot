import type { SanitizedChatRequest } from "./sanitize-request.ts";

export interface LlmProvider {
  complete(request: SanitizedChatRequest, clientSignal: AbortSignal): Promise<Response>;
}

export interface LlmConfig {
  provider: LlmProvider;
  allowedModels?: ReadonlySet<string>;
  maxResponseBytes: number;
}

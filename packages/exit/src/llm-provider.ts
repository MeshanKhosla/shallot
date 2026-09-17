import { Context, type Effect } from "effect";
import type { ProviderFailure } from "./errors.ts";
import type { SanitizedChatRequest } from "./sanitize-request.ts";

export class LlmProvider extends Context.Service<
  LlmProvider,
  {
    complete(
      request: SanitizedChatRequest,
      clientSignal: AbortSignal,
    ): Effect.Effect<Response, ProviderFailure>;
  }
>()("@shallot/exit/LlmProvider") {}

export type LlmProviderService = LlmProvider["Service"];

export interface LlmConfig {
  url: URL;
  apiKey?: string;
  timeoutMs: number;
  allowedModels?: ReadonlySet<string>;
  maxResponseBytes: number;
}

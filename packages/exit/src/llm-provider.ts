import { Context, type Effect } from "effect";
import type { ProviderFailure } from "./errors.ts";
import type { SanitizedChatRequest } from "./sanitize-request.ts";

export class LlmProvider extends Context.Service<
  LlmProvider,
  {
    readonly policy: LlmProviderPolicy;
    complete(request: SanitizedChatRequest): Effect.Effect<Response, ProviderFailure>;
  }
>()("@shallot/exit/LlmProvider") {}

export type LlmProviderService = LlmProvider["Service"];

export interface LlmProviderPolicy {
  allowedModels?: ReadonlySet<string>;
  maxResponseBytes: number;
}

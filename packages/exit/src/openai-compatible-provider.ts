import { Effect } from "effect";
import { ProviderTimeout, ProviderTransportFailure } from "./errors.ts";
import type { LlmProviderService } from "./llm-provider.ts";
import type { SanitizedChatRequest } from "./sanitize-request.ts";

export type ProviderFetch = (input: URL, init: RequestInit) => Promise<Response>;

export interface OpenAICompatibleProviderConfig {
  url: URL;
  apiKey?: string;
  timeoutMs: number;
  fetch?: ProviderFetch;
  timeoutSignal?: (timeoutMs: number) => AbortSignal;
}

export class OpenAICompatibleProvider implements LlmProviderService {
  private readonly fetch: ProviderFetch;
  private readonly timeoutSignal: (timeoutMs: number) => AbortSignal;

  constructor(private readonly config: OpenAICompatibleProviderConfig) {
    this.fetch = config.fetch ?? fetch;
    this.timeoutSignal = config.timeoutSignal ?? AbortSignal.timeout;
  }

  complete(
    request: SanitizedChatRequest,
    clientSignal: AbortSignal,
  ): Effect.Effect<Response, ProviderTimeout | ProviderTransportFailure> {
    const headers = new Headers({
      accept: request.stream === true ? "text/event-stream" : "application/json",
      "content-type": "application/json",
    });
    if (this.config.apiKey) {
      headers.set("authorization", `Bearer ${this.config.apiKey}`);
    }

    return Effect.tryPromise({
      try: (effectSignal) => {
        const timeoutSignal = this.timeoutSignal(this.config.timeoutMs);
        return this.fetch(this.config.url, {
          method: "POST",
          headers,
          body: JSON.stringify(request),
          signal: AbortSignal.any([clientSignal, effectSignal, timeoutSignal]),
        }).catch((cause) => {
          if (timeoutSignal.aborted && !clientSignal.aborted) {
            throw new ProviderTimeout();
          }
          throw cause;
        });
      },
      catch: (cause) =>
        cause instanceof ProviderTimeout ? cause : new ProviderTransportFailure(),
    });
  }
}

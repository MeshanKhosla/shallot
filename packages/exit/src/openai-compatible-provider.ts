import { Context, Effect, Layer } from "effect";
import { ProviderTimeout, ProviderTransportFailure } from "./errors.ts";
import {
  LlmProvider,
  type LlmProviderPolicy,
  type LlmProviderService,
} from "./llm-provider.ts";
import type { SanitizedChatRequest } from "./sanitize-request.ts";

export type ProviderFetch = (input: URL, init: RequestInit) => Promise<Response>;

export interface OpenAICompatibleProviderConfig {
  url: URL;
  apiKey?: string;
  timeoutMs: number;
  policy: LlmProviderPolicy;
}

export class ProviderTransport extends Context.Service<
  ProviderTransport,
  {
    readonly fetch: ProviderFetch;
    readonly timeoutSignal: (timeoutMs: number) => AbortSignal;
  }
>()("@shallot/exit/ProviderTransport") {}

export const providerTransportLive = Layer.succeed(ProviderTransport, {
  fetch,
  timeoutSignal: AbortSignal.timeout,
});

export function openAICompatibleProviderLive(
  config: OpenAICompatibleProviderConfig,
): Layer.Layer<LlmProvider> {
  return openAICompatibleProviderLayer(config).pipe(Layer.provide(providerTransportLive));
}

export function openAICompatibleProviderLayer(
  config: OpenAICompatibleProviderConfig,
): Layer.Layer<LlmProvider, never, ProviderTransport> {
  return Layer.effect(
    LlmProvider,
    Effect.gen(function* () {
      const transport = yield* ProviderTransport;
      return new OpenAICompatibleProvider(config, transport);
    }),
  );
}

class OpenAICompatibleProvider implements LlmProviderService {
  readonly policy: LlmProviderPolicy;

  constructor(
    private readonly config: OpenAICompatibleProviderConfig,
    private readonly transport: ProviderTransport["Service"],
  ) {
    this.policy = config.policy;
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
        const timeoutSignal = this.transport.timeoutSignal(this.config.timeoutMs);
        return this.transport
          .fetch(this.config.url, {
            method: "POST",
            headers,
            body: JSON.stringify(request),
            signal: AbortSignal.any([clientSignal, effectSignal, timeoutSignal]),
          })
          .catch((cause) => {
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

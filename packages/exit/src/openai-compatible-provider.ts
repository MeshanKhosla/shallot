import { Context, Effect, Layer, Redacted } from "effect";
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
  apiKey?: Redacted.Redacted<string>;
  timeoutMs: number;
  policy: LlmProviderPolicy;
}

export class ProviderTransport extends Context.Service<
  ProviderTransport,
  {
    readonly fetch: ProviderFetch;
  }
>()("@shallot/exit/ProviderTransport") {}

export const providerTransportLive = Layer.succeed(ProviderTransport, {
  fetch,
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
      headers.set("authorization", `Bearer ${Redacted.value(this.config.apiKey)}`);
    }

    const { config, transport } = this;
    return Effect.gen(function* () {
      const deadline = yield* makeDeadline(config.timeoutMs);
      const response = yield* Effect.tryPromise({
        try: (effectSignal) =>
          transport.fetch(config.url, {
            method: "POST",
            headers,
            body: JSON.stringify(request),
            signal: AbortSignal.any([clientSignal, effectSignal, deadline.signal]),
          }),
        catch: () =>
          deadline.expired ? new ProviderTimeout() : new ProviderTransportFailure(),
      }).pipe(Effect.onError(() => deadline.cancel));

      if (!response.body) {
        yield* deadline.cancel;
        return response;
      }
      return new Response(keepDeadlineUntilStreamEnds(response.body, deadline), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    });
  }
}

import { keepDeadlineUntilStreamEnds, makeDeadline } from "@shallot/server-runtime";

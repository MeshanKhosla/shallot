import { SEALED_STREAM_CONTENT_TYPE } from "@shallot/protocol";
import { keepDeadlineUntilStreamEnds, makeDeadline } from "@shallot/server-runtime";
import { Context, Effect, Layer, Redacted } from "effect";
import {
  ExitEmptyResponse,
  ExitRejected,
  ExitTimeout,
  ExitTransportFailure,
} from "./errors.ts";

export type ExitClientError =
  | ExitTimeout
  | ExitTransportFailure
  | ExitRejected
  | ExitEmptyResponse;

export type RelayFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface ExitClientConfig {
  readonly url: URL;
  readonly token: Redacted.Redacted<string>;
  readonly timeoutMs: number;
}

export class ExitClient extends Context.Service<
  ExitClient,
  {
    forward(rawBody: string): Effect.Effect<ReadableStream<Uint8Array>, ExitClientError>;
  }
>()("@shallot/relay/ExitClient") {}

export class ExitTransport extends Context.Service<
  ExitTransport,
  {
    readonly fetch: RelayFetch;
  }
>()("@shallot/relay/ExitTransport") {}

export const exitTransportLive = Layer.succeed(ExitTransport, {
  fetch,
});

export function exitClientLayer(
  config: ExitClientConfig,
): Layer.Layer<ExitClient, never, ExitTransport> {
  const headers = new Headers({
    accept: SEALED_STREAM_CONTENT_TYPE,
    authorization: `Bearer ${Redacted.value(config.token)}`,
    "content-type": "application/json",
  });
  return Layer.effect(
    ExitClient,
    Effect.gen(function* () {
      const transport = yield* ExitTransport;
      return ExitClient.of({
        forward: (rawBody) =>
          Effect.gen(function* () {
            const deadline = yield* makeDeadline(config.timeoutMs);
            const response = yield* Effect.tryPromise({
              try: (effectSignal) =>
                transport.fetch(config.url, {
                  method: "POST",
                  headers,
                  body: rawBody,
                  signal: AbortSignal.any([effectSignal, deadline.signal]),
                }),
              catch: () =>
                deadline.expired ? new ExitTimeout() : new ExitTransportFailure(),
            }).pipe(Effect.onError(() => deadline.cancel));

            if (!response.ok) {
              yield* Effect.promise(async () => {
                await response.body?.cancel().catch(() => undefined);
              });
              yield* deadline.cancel;
              return yield* new ExitRejected({ status: response.status });
            }
            if (!response.body) {
              yield* deadline.cancel;
              return yield* new ExitEmptyResponse();
            }
            return keepDeadlineUntilStreamEnds(response.body, deadline);
          }),
      });
    }),
  );
}

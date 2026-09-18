import { SEALED_STREAM_CONTENT_TYPE } from "@shallot/protocol";
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
    forward(
      rawBody: string,
      clientSignal: AbortSignal,
    ): Effect.Effect<ReadableStream<Uint8Array>, ExitClientError>;
  }
>()("@shallot/relay/ExitClient") {}

export class ExitTransport extends Context.Service<
  ExitTransport,
  {
    readonly fetch: RelayFetch;
    readonly timeoutSignal: (timeoutMs: number) => AbortSignal;
  }
>()("@shallot/relay/ExitTransport") {}

export const exitTransportLive = Layer.succeed(ExitTransport, {
  fetch,
  timeoutSignal: AbortSignal.timeout,
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
        forward: (rawBody, clientSignal) =>
          Effect.gen(function* () {
            const timeout = transport.timeoutSignal(config.timeoutMs);
            const response = yield* Effect.tryPromise({
              try: (effectSignal) =>
                transport.fetch(config.url, {
                  method: "POST",
                  headers,
                  body: rawBody,
                  signal: AbortSignal.any([clientSignal, effectSignal, timeout]),
                }),
              catch: () =>
                timeout.aborted && !clientSignal.aborted
                  ? new ExitTimeout()
                  : new ExitTransportFailure(),
            });

            if (!response.ok) {
              yield* Effect.promise(async () => {
                await response.body?.cancel().catch(() => undefined);
              });
              return yield* new ExitRejected({ status: response.status });
            }
            if (!response.body) return yield* new ExitEmptyResponse();
            return response.body;
          }),
      });
    }),
  );
}

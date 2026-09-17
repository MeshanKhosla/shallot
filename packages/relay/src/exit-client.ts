import { SEALED_STREAM_CONTENT_TYPE } from "@shallot/protocol";
import { Context, Effect, Layer } from "effect";
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
  readonly token: string;
  readonly timeoutMs: number;
}

export interface ExitClientDependencies {
  readonly fetch?: RelayFetch;
  readonly timeoutSignal?: (timeoutMs: number) => AbortSignal;
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

export function exitClientLayer(
  config: ExitClientConfig,
  dependencies: ExitClientDependencies = {},
): Layer.Layer<ExitClient> {
  const headers = new Headers({
    accept: SEALED_STREAM_CONTENT_TYPE,
    authorization: `Bearer ${config.token}`,
    "content-type": "application/json",
  });
  const exitFetch = dependencies.fetch ?? fetch;
  const timeoutSignal = dependencies.timeoutSignal ?? AbortSignal.timeout;

  return Layer.succeed(ExitClient, {
    forward: (rawBody, clientSignal) =>
      Effect.gen(function* () {
        const timeout = timeoutSignal(config.timeoutMs);
        const response = yield* Effect.tryPromise({
          try: (effectSignal) =>
            exitFetch(config.url, {
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
}

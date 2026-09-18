import { SEALED_STREAM_CONTENT_TYPE, type SealedRequest } from "@shallot/protocol";
import { keepDeadlineUntilStreamEnds, makeDeadline } from "@shallot/server-runtime";
import { Context, Effect, Layer } from "effect";
import {
  RelayEmptyResponse,
  RelayRejected,
  RelayTimeout,
  RelayTransportFailure,
} from "./errors.ts";

export type RelayClientError =
  | RelayTimeout
  | RelayTransportFailure
  | RelayRejected
  | RelayEmptyResponse;

export type SidecarFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface RelayClientConfig {
  readonly url: URL;
  readonly timeoutMs: number;
}

export class RelayClient extends Context.Service<
  RelayClient,
  {
    forward(
      request: Request,
      envelope: SealedRequest,
    ): Effect.Effect<ReadableStream<Uint8Array>, RelayClientError>;
  }
>()("@shallot/client/RelayClient") {}

export class RelayTransport extends Context.Service<
  RelayTransport,
  {
    readonly fetch: SidecarFetch;
  }
>()("@shallot/client/RelayTransport") {}

export const relayTransportLive = Layer.succeed(RelayTransport, {
  fetch,
});

export function relayClientLayer(
  config: RelayClientConfig,
): Layer.Layer<RelayClient, never, RelayTransport> {
  return Layer.effect(
    RelayClient,
    Effect.gen(function* () {
      const transport = yield* RelayTransport;
      return RelayClient.of({
        forward: (request, envelope) =>
          Effect.gen(function* () {
            const deadline = yield* makeDeadline(config.timeoutMs);
            const response = yield* Effect.tryPromise({
              try: (effectSignal) =>
                transport.fetch(config.url, {
                  method: "POST",
                  headers: relayHeaders(request),
                  body: JSON.stringify(envelope),
                  signal: AbortSignal.any([
                    request.signal,
                    effectSignal,
                    deadline.signal,
                  ]),
                }),
              catch: () =>
                deadline.expired ? new RelayTimeout() : new RelayTransportFailure(),
            }).pipe(Effect.onError(() => deadline.cancel));

            if (!response.ok) {
              yield* Effect.promise(async () => {
                await response.body?.cancel().catch(() => undefined);
              });
              yield* deadline.cancel;
              return yield* new RelayRejected({ status: response.status });
            }
            if (!response.body) {
              yield* deadline.cancel;
              return yield* new RelayEmptyResponse();
            }

            return keepDeadlineUntilStreamEnds(response.body, deadline);
          }),
      });
    }),
  );
}

function relayHeaders(req: Request): Headers {
  const headers = new Headers({
    accept: SEALED_STREAM_CONTENT_TYPE,
    "content-type": "application/json",
  });
  const authorization = req.headers.get("authorization");

  if (authorization) headers.set("authorization", authorization);
  return headers;
}

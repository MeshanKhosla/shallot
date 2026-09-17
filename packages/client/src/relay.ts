import { SEALED_STREAM_CONTENT_TYPE, type SealedRequest } from "@shallot/protocol";
import { Context, Effect, Layer } from "effect";
import type { SidecarConfig } from "./config.ts";
import {
  RelayEmptyResponse,
  RelayRejected,
  RelayTimeout,
  RelayTransportFailure,
} from "./errors.ts";

function relayHeaders(req: Request): Headers {
  const headers = new Headers({
    accept: SEALED_STREAM_CONTENT_TYPE,
    "content-type": "application/json",
  });
  const authorization = req.headers.get("authorization");

  if (authorization) headers.set("authorization", authorization);
  return headers;
}

export type RelayClientError =
  | RelayTimeout
  | RelayTransportFailure
  | RelayRejected
  | RelayEmptyResponse;

export class RelayClient extends Context.Service<
  RelayClient,
  {
    forward(
      request: Request,
      envelope: SealedRequest,
    ): Effect.Effect<ReadableStream<Uint8Array>, RelayClientError>;
  }
>()("@shallot/client/RelayClient") {}

export function relayClientLayer(config: SidecarConfig): Layer.Layer<RelayClient> {
  const relayFetch = config.fetch ?? fetch;
  const timeoutSignal = config.relayTimeoutSignal ?? AbortSignal.timeout;

  return Layer.succeed(RelayClient, {
    forward: (request, envelope) =>
      Effect.gen(function* () {
        const timeout = timeoutSignal(config.relayTimeoutMs);
        const response = yield* Effect.tryPromise({
          try: (effectSignal) =>
            relayFetch(config.relayUrl, {
              method: "POST",
              headers: relayHeaders(request),
              body: JSON.stringify(envelope),
              signal: AbortSignal.any([request.signal, effectSignal, timeout]),
            }),
          catch: () =>
            timeout.aborted && !request.signal.aborted
              ? new RelayTimeout()
              : new RelayTransportFailure(),
        });

        if (!response.ok) {
          yield* Effect.promise(async () => {
            await response.body?.cancel().catch(() => undefined);
          });
          return yield* new RelayRejected({ status: response.status });
        }
        if (!response.body) return yield* new RelayEmptyResponse();

        return response.body;
      }),
  });
}

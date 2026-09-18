import {
  createDebugLogger,
  type DebugLogger,
  formatCiphertextPreview,
} from "@shallot/observability";
import { PATHS, sealRequest } from "@shallot/protocol";
import {
  type DefectReporter,
  defectReporterLive,
  recoverDefect,
  serveWebHandler,
} from "@shallot/server-runtime";
import { Effect, Layer } from "effect";
import { readChatRequest } from "./chat-request.ts";
import type { SidecarConfig } from "./config.ts";
import {
  MalformedEncryptedResponse,
  SidecarInvalidRequest,
  type SidecarRequestError,
  SidecarRequestTooLarge,
  SidecarRouteNotFound,
  SidecarUnsupportedContentType,
  sidecarDefectResponse,
  sidecarErrorResponse,
} from "./errors.ts";
import { RelayClient, relayClientLayer, relayTransportLive } from "./relay.ts";
import { createBufferedResponse, createStreamingResponse } from "./response.ts";

export function createSidecarServer(
  config: SidecarConfig,
  services: Layer.Layer<RelayClient> = sidecarLive(config),
  options: {
    readonly diagnostics?: Layer.Layer<DefectReporter>;
    readonly logger?: DebugLogger;
  } = {},
) {
  const logger = options.logger ?? createDebugLogger("sidecar");
  const dependencies = Layer.merge(services, options.diagnostics ?? defectReporterLive);
  return serveWebHandler(
    {
      port: config.port,
      hostname: config.hostname,
      idleTimeout: 60,
    },
    (req) =>
      handleSidecarRequest(req, config, logger).pipe(
        Effect.catch((error) => Effect.succeed(sidecarErrorResponse(error))),
        Effect.catchCause(recoverDefect("sidecar", sidecarDefectResponse)),
        Effect.withSpan("sidecar.request"),
      ),
  ).pipe(Effect.provide(dependencies));
}

export function sidecarLive(config: SidecarConfig): Layer.Layer<RelayClient> {
  return relayClientLayer({
    url: config.relayUrl,
    timeoutMs: config.relayTimeoutMs,
  }).pipe(Layer.provide(relayTransportLive));
}

export const handleSidecarRequest = Effect.fnUntraced(function* (
  req: Request,
  config: SidecarConfig,
  logger = createDebugLogger("sidecar"),
): Effect.fn.Return<Response, SidecarRequestError, RelayClient> {
  const url = new URL(req.url);
  if (req.method !== "POST" || url.pathname !== PATHS.chat) {
    return yield* new SidecarRouteNotFound();
  }

  const chat = yield* expectedPromise(
    () => readChatRequest(req, config.maxRequestBytes),
    isRequestReadError,
  );
  yield* Effect.sync(() =>
    logger.debug("request.received", {
      tenantCredential: req.headers.has("authorization") ? "present" : "missing",
      request: chat.value,
    }),
  );

  const sealed = yield* Effect.promise(() =>
    sealRequest(chat.body, {
      exitPublicKey: config.exitPublicKey,
      keyId: config.exitKeyId,
      paddingBytes: config.requestPaddingBytes,
    }),
  );
  yield* Effect.sync(() =>
    logger.debug("request.encrypted", {
      requestId: sealed.envelope.requestId,
      keyId: sealed.envelope.keyId,
      prompt: formatCiphertextPreview(sealed.envelope.ciphertext),
      ciphertextCharacters: sealed.envelope.ciphertext.length,
    }),
  );

  const relayClient = yield* RelayClient;
  const relayBody = yield* relayClient.forward(req, sealed.envelope);
  const createResponse = () =>
    chat.value.stream === true
      ? createStreamingResponse(
          relayBody,
          sealed.responsePrivateKey,
          sealed.envelope.requestId,
          config,
          logger,
        )
      : createBufferedResponse(
          relayBody,
          sealed.responsePrivateKey,
          sealed.envelope.requestId,
          config,
          logger,
        );

  return yield* expectedPromise(
    createResponse,
    (cause): cause is MalformedEncryptedResponse =>
      cause instanceof MalformedEncryptedResponse,
  );
});

function expectedPromise<A, E>(
  evaluate: () => Promise<A>,
  guard: (cause: unknown) => cause is E,
): Effect.Effect<A, E> {
  return Effect.tryPromise({
    try: evaluate,
    catch: (cause) => {
      if (guard(cause)) return cause;
      throw cause;
    },
  });
}

function isRequestReadError(
  cause: unknown,
): cause is
  | SidecarUnsupportedContentType
  | SidecarInvalidRequest
  | SidecarRequestTooLarge {
  return (
    cause instanceof SidecarUnsupportedContentType ||
    cause instanceof SidecarInvalidRequest ||
    cause instanceof SidecarRequestTooLarge
  );
}

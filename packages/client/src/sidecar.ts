import { createDebugLogger, formatCiphertextPreview } from "@shallot/observability";
import { PATHS, sealRequest } from "@shallot/protocol";
import type { Server } from "bun";
import { Effect, ManagedRuntime } from "effect";
import { readChatRequest } from "./chat-request.ts";
import { loadConfig, type SidecarConfig } from "./config.ts";
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
import { RelayClient, relayClientLayer } from "./relay.ts";
import { createBufferedResponse, createStreamingResponse } from "./response.ts";

function expectedPromise<A, E>(
  evaluate: () => Promise<A>,
  guard: (cause: unknown) => cause is E,
): Effect.Effect<A, E> {
  return Effect.promise(evaluate).pipe(
    Effect.catchDefect((cause) =>
      guard(cause) ? Effect.fail(cause) : Effect.die(cause),
    ),
  );
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

export const handleSidecarRequest = Effect.fn("handleSidecarRequest")(function* (
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

function stopWithRuntime(
  server: Server<undefined>,
  runtime: ManagedRuntime.ManagedRuntime<RelayClient, never>,
): void {
  const stop = server.stop.bind(server);
  server.stop = async (closeActiveConnections?: boolean) => {
    await Promise.all([stop(closeActiveConnections), runtime.dispose()]);
  };
}

export function createSidecarServer(
  config: SidecarConfig = loadConfig(),
): Server<undefined> {
  const logger = createDebugLogger("sidecar");
  const runtime = ManagedRuntime.make(relayClientLayer(config));
  const server = Bun.serve({
    port: config.port,
    hostname: config.hostname,
    idleTimeout: 60,
    fetch(req) {
      const program = handleSidecarRequest(req, config, logger).pipe(
        Effect.catch((error) => Effect.succeed(sidecarErrorResponse(error))),
        Effect.annotateLogs({ component: "sidecar" }),
        Effect.withSpan("sidecar.request"),
      );
      return runtime
        .runPromise(program, { signal: req.signal })
        .catch(() => sidecarDefectResponse());
    },
  });
  stopWithRuntime(server, runtime);
  return server;
}

import { createDebugLogger, formatCiphertextPreview } from "@shallot/observability";
import {
  BodyTooLargeError,
  type OpenedRequestContext,
  openRequest,
  PATHS,
  parseSealedRequest,
  readLimitedBody,
  type SealedRequest,
} from "@shallot/protocol";
import type { Server } from "bun";
import { Effect, Layer, ManagedRuntime } from "effect";
import type { ExitConfig } from "./config.ts";
import {
  ExitAuthenticationError,
  ExitInvalidRequest,
  ExitReplayDetected,
  type ExitRequestError,
  ExitRequestTooLarge,
  ExitRouteNotFound,
  encryptedProviderFailure,
  exitDefectResponse,
  exitErrorResponse,
} from "./errors.ts";
import { LlmProvider } from "./llm-provider.ts";
import { ReplayProtection, replayProtectionLayer } from "./replay-protection.ts";
import { sealProviderResponse } from "./response-sealer.ts";
import { sanitizeChatRequest } from "./sanitize-request.ts";
import { requireRelayAuthorization } from "./service-auth.ts";

function expectedDefect<A, E>(
  evaluate: () => A,
  guard: (cause: unknown) => cause is E,
): Effect.Effect<A, E> {
  return Effect.sync(evaluate).pipe(
    Effect.catchDefect((cause) =>
      guard(cause) ? Effect.fail(cause) : Effect.die(cause),
    ),
  );
}

function readEnvelope(
  req: Request,
  maxBytes: number,
): Effect.Effect<SealedRequest, ExitRequestTooLarge | ExitInvalidRequest> {
  const readBody = Effect.promise(() => readLimitedBody(req, maxBytes)).pipe(
    Effect.catchDefect((cause) =>
      cause instanceof BodyTooLargeError
        ? Effect.fail(new ExitRequestTooLarge())
        : Effect.die(cause),
    ),
  );

  return Effect.gen(function* () {
    const body = yield* readBody;
    return yield* Effect.try({
      try: () => parseSealedRequest(JSON.parse(new TextDecoder().decode(body))),
      catch: () => new ExitInvalidRequest({ message: "Invalid encrypted request" }),
    });
  });
}

function openEnvelope(
  envelope: SealedRequest,
  config: ExitConfig,
): Effect.Effect<OpenedRequestContext, ExitInvalidRequest> {
  const privateKey = config.privateKeys.get(envelope.keyId);
  if (!privateKey) {
    return Effect.fail(new ExitInvalidRequest({ message: "Unknown Exit key" }));
  }
  return Effect.tryPromise({
    try: () => openRequest(envelope, privateKey),
    catch: () => new ExitInvalidRequest({ message: "Invalid encrypted request" }),
  });
}

function sealResponse(
  response: Response,
  opened: OpenedRequestContext,
  requestId: string,
  config: ExitConfig,
  logger: ReturnType<typeof createDebugLogger>,
): Effect.Effect<Response> {
  return Effect.promise(() =>
    sealProviderResponse(response, opened.responsePublicKey, requestId, config, logger),
  );
}

export const handleExitRequest = Effect.fn("handleExitRequest")(function* (
  req: Request,
  config: ExitConfig,
  logger = createDebugLogger("exit"),
): Effect.fn.Return<Response, ExitRequestError, LlmProvider | ReplayProtection> {
  const url = new URL(req.url);
  if (req.method !== "POST" || url.pathname !== PATHS.chat) {
    return yield* new ExitRouteNotFound();
  }

  yield* expectedDefect(
    () => requireRelayAuthorization(req.headers.get("authorization"), config.relayToken),
    (cause): cause is ExitAuthenticationError => cause instanceof ExitAuthenticationError,
  );

  const envelope = yield* readEnvelope(req, config.maxEnvelopeBytes);
  yield* Effect.sync(() =>
    logger.debug("request.received", {
      tenantId: "unknown",
      requestId: envelope.requestId,
      keyId: envelope.keyId,
      prompt: formatCiphertextPreview(envelope.ciphertext),
      ciphertextCharacters: envelope.ciphertext.length,
    }),
  );

  const opened = yield* openEnvelope(envelope, config);
  const sanitized = yield* expectedDefect(
    () => {
      const plaintext = JSON.parse(opened.payload.toString("utf8"));
      return sanitizeChatRequest(plaintext, config.llm.allowedModels);
    },
    (cause): cause is ExitInvalidRequest => cause instanceof ExitInvalidRequest,
  ).pipe(
    Effect.tap((request) =>
      Effect.sync(() =>
        logger.debug("request.decrypted", {
          tenantId: "unknown",
          requestId: envelope.requestId,
          request,
        }),
      ),
    ),
    Effect.catch((error) =>
      sealResponse(exitErrorResponse(error), opened, envelope.requestId, config, logger),
    ),
  );
  if (sanitized instanceof Response) return sanitized;

  const replayProtection = yield* ReplayProtection;
  const replayKey = `${envelope.keyId}:${envelope.encapsulatedKey}`;
  if (!(yield* replayProtection.claim(replayKey))) {
    return yield* new ExitReplayDetected();
  }

  const provider = yield* LlmProvider;
  const providerResponse = yield* provider
    .complete(sanitized, req.signal)
    .pipe(Effect.catch((error) => Effect.succeed(encryptedProviderFailure(error))));

  return yield* sealResponse(
    providerResponse,
    opened,
    envelope.requestId,
    config,
    logger,
  );
});

function stopWithRuntime(
  server: Server<undefined>,
  runtime: ManagedRuntime.ManagedRuntime<LlmProvider | ReplayProtection, never>,
): void {
  const stop = server.stop.bind(server);
  server.stop = async (closeActiveConnections?: boolean) => {
    await Promise.all([stop(closeActiveConnections), runtime.dispose()]);
  };
}

export function createExitServer(config: ExitConfig): Server<undefined> {
  const logger = createDebugLogger("exit");
  const layer = Layer.mergeAll(
    Layer.succeed(LlmProvider, config.llm.provider),
    replayProtectionLayer(config.replayCache),
  );
  const runtime = ManagedRuntime.make(layer);
  const server = Bun.serve({
    port: config.port,
    hostname: config.hostname,
    idleTimeout: 60,
    fetch(req) {
      const program = handleExitRequest(req, config, logger).pipe(
        Effect.catch((error) => Effect.succeed(exitErrorResponse(error))),
        Effect.annotateLogs({ component: "exit" }),
        Effect.withSpan("exit.request"),
      );
      return runtime
        .runPromise(program, { signal: req.signal })
        .catch(() => exitDefectResponse());
    },
  });
  stopWithRuntime(server, runtime);
  return server;
}

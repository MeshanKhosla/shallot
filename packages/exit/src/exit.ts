import {
  createDebugLogger,
  type DebugLogger,
  formatCiphertextPreview,
} from "@shallot/observability";
import {
  BodyTooLargeError,
  type OpenedRequestContext,
  openRequest,
  PATHS,
  parseSealedRequest,
  readLimitedBody,
  type SealedRequest,
} from "@shallot/protocol";
import {
  bindRuntimeLifecycle,
  type DefectReporter,
  defectReporterLive,
  recoverDefect,
} from "@shallot/server-runtime";
import type { Server } from "bun";
import { Effect, Layer, ManagedRuntime, type Redacted } from "effect";
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
import { type SanitizedChatRequest, sanitizeChatRequest } from "./sanitize-request.ts";
import { requireRelayAuthorization } from "./service-auth.ts";

export type ExitServices = LlmProvider | ReplayProtection;

export function createExitServer(
  config: ExitConfig,
  services: Layer.Layer<ExitServices>,
  options: {
    readonly diagnostics?: Layer.Layer<DefectReporter>;
    readonly logger?: DebugLogger;
  } = {},
): Server<undefined> {
  const logger = options.logger ?? createDebugLogger("exit");
  const runtime = ManagedRuntime.make(
    Layer.merge(services, options.diagnostics ?? defectReporterLive),
  );
  const server = Bun.serve({
    port: config.port,
    hostname: config.hostname,
    idleTimeout: 60,
    fetch(req) {
      const program = handleExitRequest(req, config, logger).pipe(
        Effect.catch((error) => Effect.succeed(exitErrorResponse(error))),
        Effect.catchCause(recoverDefect("exit", exitDefectResponse)),
      );
      return runtime
        .runPromise(program, { signal: req.signal })
        .catch(exitDefectResponse);
    },
  });
  return bindRuntimeLifecycle(server, runtime);
}

export function exitLive(
  config: ExitConfig,
  provider: Layer.Layer<LlmProvider>,
): Layer.Layer<ExitServices> {
  return Layer.mergeAll(
    provider,
    replayProtectionLayer({
      ttlMs: config.replayTtlMs,
      maxEntries: config.replayMaxEntries,
    }),
  );
}

export const handleExitRequest = Effect.fnUntraced(function* (
  req: Request,
  config: ExitConfig,
  logger = createDebugLogger("exit"),
): Effect.fn.Return<Response, ExitRequestError, LlmProvider | ReplayProtection> {
  const url = new URL(req.url);
  if (req.method !== "POST" || url.pathname !== PATHS.chat) {
    return yield* new ExitRouteNotFound();
  }

  yield* authenticateRelay(req.headers.get("authorization"), config.relayToken);

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
  const provider = yield* LlmProvider;
  return yield* Effect.gen(function* () {
    const replayProtection = yield* ReplayProtection;
    const replayKey = `${envelope.keyId}:${envelope.encapsulatedKey}`;
    if (!(yield* replayProtection.claim(replayKey))) {
      return yield* new ExitReplayDetected();
    }

    const sanitized = yield* parseSealedPayload(
      opened.payload,
      provider.policy.allowedModels,
    );
    yield* Effect.sync(() =>
      logger.debug("request.decrypted", {
        tenantId: "unknown",
        requestId: envelope.requestId,
        request: sanitized,
      }),
    );

    const providerResponse = yield* provider
      .complete(sanitized, req.signal)
      .pipe(Effect.catch((error) => Effect.succeed(encryptedProviderFailure(error))));

    return yield* sealResponse(
      providerResponse,
      opened,
      envelope.requestId,
      config,
      provider.policy.maxResponseBytes,
      logger,
    );
  }).pipe(
    Effect.catch((error) =>
      sealResponse(
        exitErrorResponse(error),
        opened,
        envelope.requestId,
        config,
        provider.policy.maxResponseBytes,
        logger,
      ),
    ),
  );
});

function authenticateRelay(
  authorization: string | null,
  expectedToken: Redacted.Redacted<string>,
): Effect.Effect<void, ExitAuthenticationError> {
  return Effect.try({
    try: () => requireRelayAuthorization(authorization, expectedToken),
    catch: (cause) => {
      if (cause instanceof ExitAuthenticationError) return cause;
      throw cause;
    },
  });
}

function parseSealedPayload(
  payload: Buffer,
  allowedModels?: ReadonlySet<string>,
): Effect.Effect<SanitizedChatRequest, ExitInvalidRequest> {
  return Effect.gen(function* () {
    const plaintext = yield* Effect.try({
      try: () => JSON.parse(payload.toString("utf8")),
      catch: () =>
        new ExitInvalidRequest({ message: "Decrypted request is not valid JSON" }),
    });
    return yield* Effect.try({
      try: () => sanitizeChatRequest(plaintext, allowedModels),
      catch: (cause) => {
        if (cause instanceof ExitInvalidRequest) return cause;
        throw cause;
      },
    });
  });
}

function readEnvelope(
  req: Request,
  maxBytes: number,
): Effect.Effect<SealedRequest, ExitRequestTooLarge | ExitInvalidRequest> {
  const readBody = Effect.tryPromise({
    try: () => readLimitedBody(req, maxBytes),
    catch: (cause) => {
      if (cause instanceof BodyTooLargeError) return new ExitRequestTooLarge();
      throw cause;
    },
  });

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
  maxResponseBytes: number,
  logger: ReturnType<typeof createDebugLogger>,
): Effect.Effect<Response> {
  return Effect.promise(() =>
    sealProviderResponse(
      response,
      opened.responsePublicKey,
      requestId,
      {
        responsePaddingBytes: config.responsePaddingBytes,
        responseFlushMs: config.responseFlushMs,
        maxResponseBytes,
      },
      logger,
    ),
  );
}

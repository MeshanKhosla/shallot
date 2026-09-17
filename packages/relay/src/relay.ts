import { createDebugLogger, formatCiphertextPreview } from "@shallot/observability";
import {
  BodyTooLargeError,
  PATHS,
  parseSealedRequest,
  readLimitedBody,
  SEALED_STREAM_CONTENT_TYPE,
  type SealedRequest,
} from "@shallot/protocol";
import { bindRuntimeLifecycle, recoverDefect } from "@shallot/server-runtime";
import type { Server } from "bun";
import { Effect, Layer, ManagedRuntime } from "effect";
import {
  ConcurrencyLimiter,
  concurrencyLimiterLayer,
  type RequestPermit,
} from "./concurrency-limiter.ts";
import { loadConfig, type RelayConfig } from "./config.ts";
import {
  RelayInvalidRequest,
  RelayReplayDetected,
  type RelayRequestError,
  RelayRequestTooLarge,
  RelayRouteNotFound,
  relayDefectResponse,
  relayErrorResponse,
} from "./errors.ts";
import { ExitClient, exitClientLayer } from "./exit-client.ts";
import { RequestTracker, requestTrackerLayer } from "./request-tracker.ts";
import { TenantAuthenticator, tenantAuthenticatorLayer } from "./tenant-auth.ts";

export interface RelayObservation {
  tenantId: string;
  requestId: string;
  body: string;
  forwardedHeaders: Headers;
}

export interface RelayHooks {
  readonly observe?: (observation: RelayObservation) => void;
  readonly observeResponseChunk?: (chunk: Uint8Array) => void;
}

function readEnvelope(
  req: Request,
  maxBytes: number,
): Effect.Effect<
  { envelope: SealedRequest; rawBody: string },
  RelayRequestTooLarge | RelayInvalidRequest
> {
  const readBody = Effect.tryPromise({
    try: () => readLimitedBody(req, maxBytes),
    catch: (cause) => {
      if (cause instanceof BodyTooLargeError) return new RelayRequestTooLarge();
      throw cause;
    },
  });

  return Effect.gen(function* () {
    const body = yield* readBody;
    const rawBody = new TextDecoder().decode(body);
    return yield* Effect.try({
      try: () => ({
        envelope: parseSealedRequest(JSON.parse(rawBody)),
        rawBody,
      }),
      catch: () => new RelayInvalidRequest(),
    });
  });
}

function proxyBody(
  body: ReadableStream<Uint8Array>,
  permit: RequestPermit,
  observe?: (chunk: Uint8Array) => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();

  return new ReadableStream({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          permit.release();
          reader.releaseLock();
          controller.close();
        } else {
          observe?.(result.value);
          controller.enqueue(result.value);
        }
      } catch (error) {
        permit.release();
        reader.releaseLock();
        controller.error(error);
      }
    },
    async cancel(reason) {
      permit.release();
      await reader.cancel(reason);
      reader.releaseLock();
    },
  });
}

export const handleRelayRequest = Effect.fn("handleRelayRequest")(function* (
  req: Request,
  config: RelayConfig,
  logger = createDebugLogger("relay"),
  hooks: RelayHooks = {},
): Effect.fn.Return<
  Response,
  RelayRequestError,
  ConcurrencyLimiter | TenantAuthenticator | RequestTracker | ExitClient
> {
  const url = new URL(req.url);
  if (req.method !== "POST" || url.pathname !== PATHS.chat) {
    return yield* new RelayRouteNotFound();
  }

  const limiter = yield* ConcurrencyLimiter;
  const permit = yield* limiter.acquire();
  let handedOff = false;

  return yield* Effect.gen(function* () {
    const authenticator = yield* TenantAuthenticator;
    const tenant = yield* authenticator.authenticate(req.headers.get("authorization"));
    const { envelope, rawBody } = yield* readEnvelope(req, config.maxEnvelopeBytes);
    yield* Effect.sync(() =>
      logger.debug("request.received", {
        tenantId: tenant.id,
        requestId: envelope.requestId,
        keyId: envelope.keyId,
        prompt: formatCiphertextPreview(envelope.ciphertext),
        ciphertextCharacters: envelope.ciphertext.length,
      }),
    );

    const requestTracker = yield* RequestTracker;
    if (!(yield* requestTracker.claim(tenant.id, envelope.requestId))) {
      return yield* new RelayReplayDetected();
    }

    const exitClient = yield* ExitClient;
    const responseBody = yield* exitClient.forward(rawBody, req.signal);
    yield* Effect.sync(() => {
      const forwardedHeaders = new Headers({
        authorization: `Bearer ${config.exitToken}`,
        "content-type": "application/json",
      });
      hooks.observe?.({
        tenantId: tenant.id,
        requestId: envelope.requestId,
        body: rawBody,
        forwardedHeaders,
      });
    });

    handedOff = true;
    return new Response(
      proxyBody(responseBody, permit, (chunk) => {
        logger.debug("response.chunk.received", {
          tenantId: tenant.id,
          requestId: envelope.requestId,
          encryptedBytes: chunk.byteLength,
        });
        hooks.observeResponseChunk?.(chunk);
      }),
      {
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-type": SEALED_STREAM_CONTENT_TYPE,
        },
      },
    );
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (!handedOff) permit.release();
      }),
    ),
  );
});

export type RelayServices =
  | ConcurrencyLimiter
  | TenantAuthenticator
  | RequestTracker
  | ExitClient;

export function relayLive(config: RelayConfig): Layer.Layer<RelayServices> {
  return Layer.mergeAll(
    tenantAuthenticatorLayer(config.tenantTokens),
    requestTrackerLayer({
      ttlMs: config.requestTtlMs,
      maxEntries: config.maxRequestEntries,
      maxEntriesPerTenant: config.maxRequestEntriesPerTenant,
    }),
    concurrencyLimiterLayer(config.maxConcurrentRequests),
    exitClientLayer({
      url: config.exitUrl,
      token: config.exitToken,
      timeoutMs: config.exitTimeoutMs,
    }),
  );
}

export function createRelayServer(
  config: RelayConfig = loadConfig(),
  services: Layer.Layer<RelayServices> = relayLive(config),
  hooks: RelayHooks = {},
): Server<undefined> {
  const logger = createDebugLogger("relay");
  const runtime = ManagedRuntime.make(services);
  const server = Bun.serve({
    port: config.port,
    hostname: config.hostname,
    idleTimeout: 60,
    fetch(req) {
      const program = handleRelayRequest(req, config, logger, hooks).pipe(
        Effect.catch((error) => Effect.succeed(relayErrorResponse(error))),
        Effect.catchCause(recoverDefect("relay", relayDefectResponse)),
      );
      return runtime
        .runPromise(program, { signal: req.signal })
        .catch(relayDefectResponse);
    },
  });
  return bindRuntimeLifecycle(server, runtime);
}

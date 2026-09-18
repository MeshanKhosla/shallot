import {
  createDebugLogger,
  type DebugLogger,
  formatBodyForDebug,
} from "@shallot/observability";
import {
  type DefectReporter,
  defectReporterLive,
  recoverDefect,
  serveWebHandler,
} from "@shallot/server-runtime";
import { Effect, type Layer, Redacted } from "effect";
import type { MockProviderConfig } from "./config.ts";
import {
  type MockProviderRequestError,
  ProviderAuthenticationError,
  ProviderInvalidRequest,
  ProviderRouteNotFound,
  providerDefectResponse,
  providerErrorResponse,
} from "./errors.ts";
import { createOpenAIResponse, parseChatRequest } from "./openai-response.ts";

export interface MockProviderHooks {
  readonly observe?: (observation: import("./config.ts").ProviderObservation) => void;
  readonly observeCancellation?: () => void;
}

export function createMockProviderServer(
  config: MockProviderConfig,
  hooks: MockProviderHooks = {},
  options: {
    readonly diagnostics?: Layer.Layer<DefectReporter>;
    readonly logger?: DebugLogger;
  } = {},
) {
  const logger = options.logger ?? createDebugLogger("provider");
  return serveWebHandler(
    {
      port: config.port,
      hostname: config.hostname,
      idleTimeout: 60,
    },
    (req) =>
      handleMockProviderRequest(req, config, logger, hooks).pipe(
        Effect.catch((error) => Effect.succeed(providerErrorResponse(error))),
        Effect.catchCause(recoverDefect("mock-provider", providerDefectResponse)),
        Effect.withSpan("provider.request"),
      ),
  ).pipe(Effect.provide(options.diagnostics ?? defectReporterLive));
}

export const handleMockProviderRequest = Effect.fnUntraced(function* (
  req: Request,
  config: MockProviderConfig,
  logger = createDebugLogger("provider"),
  hooks: MockProviderHooks = {},
): Effect.fn.Return<Response, MockProviderRequestError> {
  const url = new URL(req.url);
  if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") {
    return yield* new ProviderRouteNotFound();
  }
  if (
    config.expectedApiKey &&
    req.headers.get("authorization") !== `Bearer ${Redacted.value(config.expectedApiKey)}`
  ) {
    return yield* new ProviderAuthenticationError();
  }

  const request = yield* Effect.tryPromise({
    try: async () => parseChatRequest(await req.json()),
    catch: () => new ProviderInvalidRequest(),
  });
  yield* Effect.sync(() => {
    hooks.observe?.({
      authorization: req.headers.get("authorization"),
      request,
    });
    logger.debug("request.received", {
      tenantId: "unknown",
      request,
    });
  });

  const response = createOpenAIResponse(
    request,
    config.chunkDelayMs,
    hooks.observeCancellation,
  );
  return logger.enabled ? withDebugResponseLogging(response, logger) : response;
});

function withDebugResponseLogging(
  response: Response,
  logger: ReturnType<typeof createDebugLogger>,
): Response {
  if (!response.body) {
    logger.debug("response.sent", {
      tenantId: "unknown",
      status: response.status,
      body: "",
    });
    return response;
  }

  const decoder = new TextDecoder();
  let body = "";
  const stream = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        body += decoder.decode(chunk, { stream: true });
        controller.enqueue(chunk);
      },
      flush() {
        body += decoder.decode();
        logger.debug("response.sent", {
          tenantId: "unknown",
          status: response.status,
          body: formatBodyForDebug(body),
        });
      },
    }),
  );

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

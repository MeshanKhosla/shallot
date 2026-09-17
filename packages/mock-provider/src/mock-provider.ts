import { createDebugLogger, formatBodyForDebug } from "@shallot/observability";
import type { Server } from "bun";
import { Effect, Layer, ManagedRuntime } from "effect";
import { loadConfig, type MockProviderConfig } from "./config.ts";
import {
  type MockProviderRequestError,
  ProviderAuthenticationError,
  ProviderInvalidRequest,
  ProviderRouteNotFound,
  providerDefectResponse,
  providerErrorResponse,
} from "./errors.ts";
import { createOpenAIResponse, parseChatRequest } from "./openai-response.ts";

export const handleMockProviderRequest = Effect.fn("handleMockProviderRequest")(
  function* (
    req: Request,
    config: MockProviderConfig,
    logger = createDebugLogger("provider"),
  ): Effect.fn.Return<Response, MockProviderRequestError> {
    const url = new URL(req.url);
    if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      return yield* new ProviderRouteNotFound();
    }
    if (
      config.expectedApiKey &&
      req.headers.get("authorization") !== `Bearer ${config.expectedApiKey}`
    ) {
      return yield* new ProviderAuthenticationError();
    }

    const request = yield* Effect.tryPromise({
      try: async () => parseChatRequest(await req.json()),
      catch: () => new ProviderInvalidRequest(),
    });
    yield* Effect.sync(() => {
      config.observe?.({
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
      config.observeCancellation,
    );
    if (logger.enabled) {
      yield* Effect.sync(() => {
        void response
          .clone()
          .text()
          .then((body) => {
            logger.debug("response.sent", {
              tenantId: "unknown",
              status: response.status,
              body: formatBodyForDebug(body),
            });
          });
      });
    }
    return response;
  },
);

function stopWithRuntime(
  server: Server<undefined>,
  runtime: ManagedRuntime.ManagedRuntime<never, never>,
): void {
  const stop = server.stop.bind(server);
  server.stop = async (closeActiveConnections?: boolean) => {
    await Promise.all([stop(closeActiveConnections), runtime.dispose()]);
  };
}

export function createMockProviderServer(
  config: MockProviderConfig = loadConfig(),
): Server<undefined> {
  const logger = createDebugLogger("provider");
  const runtime = ManagedRuntime.make(Layer.empty);
  const server = Bun.serve({
    port: config.port,
    hostname: config.hostname,
    idleTimeout: 60,
    fetch(req) {
      const program = handleMockProviderRequest(req, config, logger).pipe(
        Effect.catch((error) => Effect.succeed(providerErrorResponse(error))),
        Effect.annotateLogs({ component: "mock-provider" }),
        Effect.withSpan("mock-provider.request"),
      );
      return runtime
        .runPromise(program, { signal: req.signal })
        .catch(() => providerDefectResponse());
    },
  });
  stopWithRuntime(server, runtime);
  return server;
}

import type { Server } from "bun";
import { loadConfig, type MockProviderConfig } from "./config.ts";
import { createOpenAIResponse, parseChatRequest } from "./openai-response.ts";

export function createMockProviderServer(
  config: MockProviderConfig = loadConfig(),
): Server<undefined> {
  return Bun.serve({
    port: config.port,
    idleTimeout: 60,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") {
        return Response.json(
          {
            error: { message: "only POST /v1/chat/completions", type: "not_found_error" },
          },
          { status: 404 },
        );
      }
      if (
        config.expectedApiKey &&
        req.headers.get("authorization") !== `Bearer ${config.expectedApiKey}`
      ) {
        return Response.json(
          {
            error: {
              message: "provider authentication failed",
              type: "authentication_error",
            },
          },
          { status: 401 },
        );
      }

      try {
        const request = parseChatRequest(await req.json());
        config.observe?.({
          authorization: req.headers.get("authorization"),
          request,
        });
        return createOpenAIResponse(request, config.chunkDelayMs);
      } catch {
        return Response.json(
          { error: { message: "invalid chat request", type: "invalid_request_error" } },
          { status: 400 },
        );
      }
    },
  });
}

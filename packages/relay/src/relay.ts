import {
  BodyTooLargeError,
  PATHS,
  parseSealedRequest,
  readLimitedBody,
  SEALED_STREAM_CONTENT_TYPE,
  type SealedRequest,
} from "@shallot/protocol";
import type { Server } from "bun";
import { loadConfig, type RelayConfig } from "./config.ts";
import { RelayHttpError, relayErrorResponse } from "./errors.ts";
import { forwardToExit } from "./exit-client.ts";
import { RequestTrackerCapacityError } from "./request-tracker.ts";

async function readEnvelope(
  req: Request,
  maxBytes: number,
): Promise<{ envelope: SealedRequest; rawBody: string }> {
  let body: Uint8Array;
  try {
    body = await readLimitedBody(req, maxBytes);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      throw new RelayHttpError(
        413,
        "Encrypted request is too large",
        "request_too_large",
      );
    }
    throw error;
  }

  const rawBody = new TextDecoder().decode(body);
  try {
    return {
      envelope: parseSealedRequest(JSON.parse(rawBody)),
      rawBody,
    };
  } catch {
    throw new RelayHttpError(400, "Invalid encrypted request", "invalid_request_error");
  }
}

function proxyBody(
  body: ReadableStream<Uint8Array>,
  release: () => void,
  observe?: (chunk: Uint8Array) => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let released = false;
  const releaseOnce = () => {
    if (released) return;
    released = true;
    release();
  };

  return new ReadableStream({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          releaseOnce();
          controller.close();
        } else {
          observe?.(result.value);
          controller.enqueue(result.value);
        }
      } catch (error) {
        releaseOnce();
        controller.error(error);
      }
    },
    async cancel(reason) {
      releaseOnce();
      await reader.cancel(reason);
    },
  });
}

export function createRelayServer(config: RelayConfig = loadConfig()): Server<undefined> {
  let activeRequests = 0;

  return Bun.serve({
    port: config.port,
    hostname: config.hostname,
    idleTimeout: 60,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method !== "POST" || url.pathname !== PATHS.chat) {
        return Response.json(
          { error: { message: `only POST ${PATHS.chat}`, type: "not_found_error" } },
          { status: 404 },
        );
      }

      if (activeRequests >= config.maxConcurrentRequests) {
        return relayErrorResponse(
          new RelayHttpError(429, "Relay concurrency limit reached", "rate_limit_error"),
        );
      }
      activeRequests += 1;
      let handedOff = false;
      const release = () => {
        activeRequests -= 1;
      };

      try {
        const tenant = config.authenticator.authenticate(
          req.headers.get("authorization"),
        );
        const { envelope, rawBody } = await readEnvelope(req, config.maxEnvelopeBytes);
        try {
          if (!config.requestTracker.claim(tenant.id, envelope.requestId)) {
            throw new RelayHttpError(409, "Request ID was replayed", "replay_error");
          }
        } catch (error) {
          if (error instanceof RequestTrackerCapacityError) {
            throw new RelayHttpError(
              503,
              "Relay request tracker is full",
              "overloaded_error",
            );
          }
          throw error;
        }

        const responseBody = await forwardToExit(rawBody, config, req.signal);
        const forwardedHeaders = new Headers({
          authorization: `Bearer ${config.exitToken}`,
          "content-type": "application/json",
        });
        config.observe?.({
          tenantId: tenant.id,
          requestId: envelope.requestId,
          body: rawBody,
          forwardedHeaders,
        });

        handedOff = true;
        return new Response(
          proxyBody(responseBody, release, config.observeResponseChunk),
          {
            status: 200,
            headers: {
              "cache-control": "no-store",
              "content-type": SEALED_STREAM_CONTENT_TYPE,
            },
          },
        );
      } catch (error) {
        return relayErrorResponse(error);
      } finally {
        if (!handedOff) release();
      }
    },
  });
}

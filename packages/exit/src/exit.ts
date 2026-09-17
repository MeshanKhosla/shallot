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
import type { ExitConfig } from "./config.ts";
import { ExitHttpError, exitErrorResponse } from "./errors.ts";
import { ReplayCacheCapacityError } from "./replay-cache.ts";
import { sealProviderResponse } from "./response-sealer.ts";
import { sanitizeChatRequest } from "./sanitize-request.ts";
import { requireRelayAuthorization } from "./service-auth.ts";

async function readEnvelope(req: Request, maxBytes: number): Promise<SealedRequest> {
  let body: Uint8Array;
  try {
    body = await readLimitedBody(req, maxBytes);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      throw new ExitHttpError(413, "Encrypted request is too large", "request_too_large");
    }
    throw error;
  }

  try {
    return parseSealedRequest(JSON.parse(new TextDecoder().decode(body)));
  } catch {
    throw new ExitHttpError(400, "Invalid encrypted request", "invalid_request_error");
  }
}

function encryptedError(error: unknown): Response {
  if (error instanceof ExitHttpError) {
    return Response.json(
      { error: { message: error.message, type: error.type } },
      { status: error.status },
    );
  }
  return Response.json(
    { error: { message: "Exit could not process the request", type: "exit_error" } },
    { status: 500 },
  );
}

export function createExitServer(config: ExitConfig): Server<undefined> {
  const logger = createDebugLogger("exit");

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

      try {
        requireRelayAuthorization(req.headers.get("authorization"), config.relayToken);
        const envelope = await readEnvelope(req, config.maxEnvelopeBytes);
        logger.debug("request.received", {
          tenantId: "unknown",
          requestId: envelope.requestId,
          keyId: envelope.keyId,
          prompt: formatCiphertextPreview(envelope.ciphertext),
          ciphertextCharacters: envelope.ciphertext.length,
        });
        const privateKey = config.privateKeys.get(envelope.keyId);
        if (!privateKey) {
          throw new ExitHttpError(400, "Unknown Exit key", "invalid_request_error");
        }

        let opened: OpenedRequestContext;
        try {
          opened = await openRequest(envelope, privateKey);
        } catch {
          throw new ExitHttpError(
            400,
            "Invalid encrypted request",
            "invalid_request_error",
          );
        }

        let sanitized: ReturnType<typeof sanitizeChatRequest>;
        try {
          const plaintext = JSON.parse(opened.payload.toString("utf8"));
          sanitized = sanitizeChatRequest(plaintext, config.llm.allowedModels);
          logger.debug("request.decrypted", {
            tenantId: "unknown",
            requestId: envelope.requestId,
            request: sanitized,
          });
        } catch (error) {
          return await sealProviderResponse(
            encryptedError(error),
            opened.responsePublicKey,
            envelope.requestId,
            config,
            logger,
          );
        }

        const replayKey = `${envelope.keyId}:${envelope.encapsulatedKey}`;
        try {
          if (!config.replayCache.claim(replayKey)) {
            throw new ExitHttpError(
              409,
              "Encrypted request was replayed",
              "replay_error",
            );
          }
        } catch (error) {
          if (error instanceof ReplayCacheCapacityError) {
            throw new ExitHttpError(503, "Exit replay cache is full", "overloaded_error");
          }
          throw error;
        }

        const providerResponse = await config.llm.provider.complete(
          sanitized,
          req.signal,
        );

        return await sealProviderResponse(
          providerResponse,
          opened.responsePublicKey,
          envelope.requestId,
          config,
          logger,
        );
      } catch (error) {
        return exitErrorResponse(error);
      }
    },
  });
}

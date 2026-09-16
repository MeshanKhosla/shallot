import { createDebugLogger } from "@shallot/observability";
import { PATHS, sealRequest } from "@shallot/protocol";
import type { Server } from "bun";
import { readChatRequest } from "./chat-request.ts";
import { loadConfig, type SidecarConfig } from "./config.ts";
import { errorResponse, responseFromError } from "./errors.ts";
import { forwardToRelay } from "./relay.ts";
import { createBufferedResponse, createStreamingResponse } from "./response.ts";

export function createSidecarServer(
  config: SidecarConfig = loadConfig(),
): Server<undefined> {
  const logger = createDebugLogger("sidecar");

  return Bun.serve({
    port: config.port,
    hostname: config.hostname,
    idleTimeout: 60,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method !== "POST" || url.pathname !== PATHS.chat) {
        return errorResponse(404, `only POST ${PATHS.chat}`, "not_found_error");
      }

      try {
        const chat = await readChatRequest(req, config.maxRequestBytes);
        logger.debug("request.received", {
          tenantCredential: req.headers.has("authorization") ? "present" : "missing",
          request: chat.value,
        });
        const sealed = await sealRequest(chat.body, {
          exitPublicKey: config.exitPublicKey,
          keyId: config.exitKeyId,
          paddingBytes: config.requestPaddingBytes,
        });
        logger.debug("request.encrypted", {
          requestId: sealed.envelope.requestId,
          keyId: sealed.envelope.keyId,
          prompt: "[encrypted for Exit]",
          ciphertextCharacters: sealed.envelope.ciphertext.length,
        });
        const relayBody = await forwardToRelay(req, sealed.envelope, config);

        return chat.value.stream === true
          ? await createStreamingResponse(
              relayBody,
              sealed.responsePrivateKey,
              sealed.envelope.requestId,
              config,
              logger,
            )
          : await createBufferedResponse(
              relayBody,
              sealed.responsePrivateKey,
              sealed.envelope.requestId,
              config,
              logger,
            );
      } catch (error) {
        return responseFromError(error);
      }
    },
  });
}

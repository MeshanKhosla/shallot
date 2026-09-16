import {
  type OpenedRequestContext,
  openRequest,
  PATHS,
  parseSealedRequest,
  type SealedRequest,
} from "@shallot/protocol";
import type { Server } from "bun";
import { type ExitConfig, loadConfig } from "./config.ts";
import { ExitHttpError, exitErrorResponse } from "./errors.ts";
import { callProvider } from "./provider-client.ts";
import { sealProviderResponse } from "./response-sealer.ts";
import { sanitizeChatRequest } from "./sanitize-request.ts";
import { requireRelayAuthorization } from "./service-auth.ts";

async function readEnvelope(req: Request, maxBytes: number): Promise<SealedRequest> {
  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ExitHttpError(413, "Encrypted request is too large", "request_too_large");
  }

  const body = new Uint8Array(await req.arrayBuffer());
  if (body.byteLength > maxBytes) {
    throw new ExitHttpError(413, "Encrypted request is too large", "request_too_large");
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

export function createExitServer(config: ExitConfig = loadConfig()): Server<undefined> {
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
        const privateKey = config.privateKeys.get(envelope.keyId);
        if (!privateKey) {
          throw new ExitHttpError(400, "Unknown Exit key", "invalid_request_error");
        }

        const replayKey = `${envelope.keyId}:${envelope.encapsulatedKey}`;
        if (!config.replayCache.claim(replayKey)) {
          throw new ExitHttpError(409, "Encrypted request was replayed", "replay_error");
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

        let providerResponse: Response;
        try {
          const plaintext = JSON.parse(opened.payload.toString("utf8"));
          const sanitized = sanitizeChatRequest(plaintext, config.allowedModels);
          providerResponse = await callProvider(sanitized, config, req.signal);
        } catch (error) {
          providerResponse = encryptedError(error);
        }

        return await sealProviderResponse(
          providerResponse,
          opened.responsePublicKey,
          envelope.requestId,
          config,
        );
      } catch (error) {
        return exitErrorResponse(error);
      }
    },
  });
}

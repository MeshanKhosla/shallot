import { SEALED_STREAM_CONTENT_TYPE, type SealedRequest } from "@shallot/protocol";
import type { SidecarConfig } from "./config.ts";
import { SidecarHttpError } from "./errors.ts";

export async function forwardToRelay(
  req: Request,
  envelope: SealedRequest,
  config: SidecarConfig,
): Promise<ReadableStream<Uint8Array>> {
  let response: Response;
  try {
    const signal = AbortSignal.any([
      req.signal,
      AbortSignal.timeout(config.relayTimeoutMs),
    ]);
    response = await fetch(config.relayUrl, {
      method: "POST",
      headers: relayHeaders(req),
      body: JSON.stringify(envelope),
      signal,
    });
  } catch {
    throw new SidecarHttpError(502, "Relay is unavailable", "upstream_connection_error");
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new SidecarHttpError(
      response.status,
      `Relay rejected the request with status ${response.status}`,
      "upstream_error",
    );
  }
  if (!response.body) {
    throw new SidecarHttpError(502, "Relay returned an empty response", "upstream_error");
  }

  return response.body;
}

function relayHeaders(req: Request): Headers {
  const headers = new Headers({
    accept: SEALED_STREAM_CONTENT_TYPE,
    "content-type": "application/json",
  });
  const authorization = req.headers.get("authorization");

  if (authorization) headers.set("authorization", authorization);
  return headers;
}

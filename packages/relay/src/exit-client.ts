import { SEALED_STREAM_CONTENT_TYPE } from "@shallot/protocol";
import type { RelayConfig } from "./config.ts";
import { RelayHttpError } from "./errors.ts";

export async function forwardToExit(
  rawBody: string,
  config: RelayConfig,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const headers = new Headers({
    accept: SEALED_STREAM_CONTENT_TYPE,
    authorization: `Bearer ${config.exitToken}`,
    "content-type": "application/json",
  });

  let response: Response;
  try {
    const upstreamSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(config.exitTimeoutMs),
    ]);
    response = await config.fetch(config.exitUrl, {
      method: "POST",
      headers,
      body: rawBody,
      signal: upstreamSignal,
    });
  } catch {
    throw new RelayHttpError(502, "Exit is unavailable", "upstream_connection_error");
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new RelayHttpError(
      response.status,
      `Exit rejected the request with status ${response.status}`,
      "upstream_error",
    );
  }
  if (!response.body) {
    throw new RelayHttpError(502, "Exit returned an empty response", "upstream_error");
  }
  return response.body;
}

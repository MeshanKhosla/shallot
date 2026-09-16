import type { ExitConfig } from "./config.ts";
import type { SanitizedChatRequest } from "./sanitize-request.ts";

export async function callProvider(
  request: SanitizedChatRequest,
  config: ExitConfig,
  clientSignal: AbortSignal,
): Promise<Response> {
  const timeout = AbortSignal.timeout(config.providerTimeoutMs);
  const signal = AbortSignal.any([clientSignal, timeout]);
  const headers = new Headers({
    accept: request.stream === true ? "text/event-stream" : "application/json",
    "content-type": "application/json",
  });
  if (config.providerApiKey) {
    headers.set("authorization", `Bearer ${config.providerApiKey}`);
  }

  try {
    return await config.fetch(config.providerUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal,
    });
  } catch {
    return Response.json(
      { error: { message: "AI provider is unavailable", type: "provider_error" } },
      { status: 502 },
    );
  }
}

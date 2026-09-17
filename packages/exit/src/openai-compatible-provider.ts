import type { LlmProvider } from "./llm-provider.ts";
import type { SanitizedChatRequest } from "./sanitize-request.ts";

export interface OpenAICompatibleProviderConfig {
  url: URL;
  apiKey?: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

export class OpenAICompatibleProvider implements LlmProvider {
  private readonly fetch: typeof fetch;

  constructor(private readonly config: OpenAICompatibleProviderConfig) {
    this.fetch = config.fetch ?? fetch;
  }

  async complete(
    request: SanitizedChatRequest,
    clientSignal: AbortSignal,
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const signal = AbortSignal.any([clientSignal, timeout]);
    const headers = new Headers({
      accept: request.stream === true ? "text/event-stream" : "application/json",
      "content-type": "application/json",
    });
    if (this.config.apiKey) {
      headers.set("authorization", `Bearer ${this.config.apiKey}`);
    }

    try {
      return await this.fetch(this.config.url, {
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
}

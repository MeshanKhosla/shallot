import { describe, expect, test } from "bun:test";
import { OpenAICompatibleProvider } from "./openai-compatible-provider.ts";

describe("OpenAI-compatible LLM provider", () => {
  test("owns upstream HTTP authentication and request forwarding", async () => {
    let observedUrl: string | undefined;
    let observedRequest: RequestInit | undefined;
    const provider = new OpenAICompatibleProvider({
      url: new URL("https://llm.example/v1/chat/completions"),
      apiKey: "llm-secret",
      timeoutMs: 1_000,
      fetch: (async (input, init) => {
        observedUrl = input.toString();
        observedRequest = init;
        return Response.json({ choices: [] });
      }) as typeof fetch,
    });

    const response = await provider.complete(
      { model: "test-model", messages: [], stream: true },
      new AbortController().signal,
    );

    expect(response.status).toBe(200);
    expect(observedUrl).toBe("https://llm.example/v1/chat/completions");
    expect(new Headers(observedRequest?.headers).get("authorization")).toBe(
      "Bearer llm-secret",
    );
    expect(new Headers(observedRequest?.headers).get("accept")).toBe("text/event-stream");
    expect(observedRequest?.body).toBe(
      '{"model":"test-model","messages":[],"stream":true}',
    );
  });
});

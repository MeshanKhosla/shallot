import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { OpenAICompatibleProvider } from "./openai-compatible-provider.ts";

describe("OpenAI-compatible LLM provider", () => {
  test("owns upstream HTTP authentication and request forwarding", async () => {
    let observedUrl: string | undefined;
    let observedRequest: RequestInit | undefined;
    const provider = new OpenAICompatibleProvider(
      {
        url: new URL("https://llm.example/v1/chat/completions"),
        apiKey: "llm-secret",
        timeoutMs: 1_000,
      },
      {
        fetch: async (input, init) => {
          observedUrl = input.toString();
          observedRequest = init;
          return Response.json({ choices: [] });
        },
      },
    );

    const response = await Effect.runPromise(
      provider.complete(
        { model: "test-model", messages: [], stream: true },
        new AbortController().signal,
      ),
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

  test("aborts fetch when the Effect is interrupted", async () => {
    let fetchWasAborted = false;
    const provider = new OpenAICompatibleProvider(
      {
        url: new URL("https://llm.example/v1/chat/completions"),
        timeoutMs: 1_000,
      },
      {
        fetch: (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => {
                fetchWasAborted = true;
                reject(init.signal?.reason);
              },
              { once: true },
            );
          }),
      },
    );
    const cancellation = new AbortController();
    const result = Effect.runPromise(
      provider.complete(
        { model: "test-model", messages: [] },
        new AbortController().signal,
      ),
      { signal: cancellation.signal },
    );

    cancellation.abort("test interruption");
    await expect(result).rejects.toThrow();
    expect(fetchWasAborted).toBeTrue();
  });

  test("reports timeout from a controlled timeout signal", async () => {
    const timeout = new AbortController();
    const provider = new OpenAICompatibleProvider(
      {
        url: new URL("https://llm.example/v1/chat/completions"),
        timeoutMs: 1_000,
      },
      {
        timeoutSignal: () => timeout.signal,
        fetch: (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
              once: true,
            });
          }),
      },
    );
    const failure = Effect.runPromise(
      Effect.flip(
        provider.complete(
          { model: "test-model", messages: [] },
          new AbortController().signal,
        ),
      ),
    );

    timeout.abort("controlled timeout");
    expect((await failure)._tag).toBe("ProviderTimeout");
  });
});

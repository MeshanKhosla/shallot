import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { LlmProvider } from "../src/llm-provider.ts";
import {
  openAICompatibleProviderLayer,
  type ProviderFetch,
  ProviderTransport,
} from "../src/openai-compatible-provider.ts";

const config = {
  url: new URL("https://llm.example/v1/chat/completions"),
  timeoutMs: 1_000,
  policy: {
    allowedModels: new Set(["test-model"]),
    maxResponseBytes: 1024,
  },
};

function complete(
  fetch: ProviderFetch,
  timeoutSignal = AbortSignal.timeout,
  apiKey?: string,
) {
  return Effect.gen(function* () {
    const provider = yield* LlmProvider;
    return yield* provider.complete(
      { model: "test-model", messages: [], stream: true },
      new AbortController().signal,
    );
  }).pipe(
    Effect.provide(
      openAICompatibleProviderLayer({ ...config, apiKey }).pipe(
        Layer.provide(Layer.succeed(ProviderTransport, { fetch, timeoutSignal })),
      ),
    ),
  );
}

describe("OpenAI-compatible LLM provider", () => {
  test("owns upstream HTTP authentication and request forwarding", async () => {
    let observedUrl: string | undefined;
    let observedRequest: RequestInit | undefined;
    const response = await Effect.runPromise(
      complete(
        async (input, init) => {
          observedUrl = input.toString();
          observedRequest = init;
          return Response.json({ choices: [] });
        },
        AbortSignal.timeout,
        "llm-secret",
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
    const cancellation = new AbortController();
    const result = Effect.runPromise(
      complete(
        (_input, init) =>
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
      ),
      { signal: cancellation.signal },
    );

    cancellation.abort("test interruption");
    await expect(result).rejects.toThrow();
    expect(fetchWasAborted).toBeTrue();
  });

  test("reports timeout from a controlled timeout signal", async () => {
    const timeout = new AbortController();
    const failure = Effect.runPromise(
      Effect.flip(
        complete(
          (_input, init) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
                once: true,
              });
            }),
          () => timeout.signal,
        ),
      ),
    );

    timeout.abort("controlled timeout");
    expect((await failure)._tag).toBe("ProviderTimeout");
  });
});

import { describe, expect, test } from "bun:test";
import { Effect, Layer, Redacted } from "effect";
import {
  ExitClient,
  ExitTransport,
  exitClientLayer,
  type RelayFetch,
} from "../src/exit-client.ts";

function transport(
  fetch: RelayFetch,
  timeoutSignal = AbortSignal.timeout,
): ExitTransport["Service"] {
  return { fetch, timeoutSignal };
}

const config = {
  url: new URL("https://exit.example/v1/chat/completions"),
  token: Redacted.make("exit-token"),
  timeoutMs: 1_000,
};

function forward(exitTransport: ExitTransport["Service"]) {
  return Effect.gen(function* () {
    const client = yield* ExitClient;
    return yield* client.forward("{}", new AbortController().signal);
  }).pipe(
    Effect.provide(
      exitClientLayer(config).pipe(
        Layer.provide(Layer.succeed(ExitTransport, exitTransport)),
      ),
    ),
  );
}

describe("Relay Exit client", () => {
  test("aborts fetch when the Effect is interrupted", async () => {
    let startFetch: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      startFetch = resolve;
    });
    let fetchWasAborted = false;
    const configured = transport(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          startFetch?.();
          init?.signal?.addEventListener(
            "abort",
            () => {
              fetchWasAborted = true;
              reject(init.signal?.reason);
            },
            { once: true },
          );
        }),
    );
    const cancellation = new AbortController();
    const result = Effect.runPromise(forward(configured), {
      signal: cancellation.signal,
    });

    await started;
    cancellation.abort("test interruption");
    await expect(result).rejects.toThrow();
    expect(fetchWasAborted).toBeTrue();
  });

  test("reports timeout from a controlled timeout signal", async () => {
    const timeout = new AbortController();
    const configured = transport(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
      () => timeout.signal,
    );
    const failure = Effect.runPromise(Effect.flip(forward(configured)));

    timeout.abort("controlled timeout");
    expect((await failure)._tag).toBe("ExitTimeout");
  });
});

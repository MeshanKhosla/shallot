import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  ExitClient,
  type ExitClientDependencies,
  exitClientLayer,
  type RelayFetch,
} from "../src/exit-client.ts";

function dependencies(fetch: RelayFetch): ExitClientDependencies {
  return { fetch };
}

const config = {
  url: new URL("https://exit.example/v1/chat/completions"),
  token: "exit-token",
  timeoutMs: 1_000,
};

function forward(dependencies: ExitClientDependencies) {
  return Effect.gen(function* () {
    const client = yield* ExitClient;
    return yield* client.forward("{}", new AbortController().signal);
  }).pipe(Effect.provide(exitClientLayer(config, dependencies)));
}

describe("Relay Exit client", () => {
  test("aborts fetch when the Effect is interrupted", async () => {
    let startFetch: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      startFetch = resolve;
    });
    let fetchWasAborted = false;
    const configured = dependencies(
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
    let configured = dependencies(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    configured = { ...configured, timeoutSignal: () => timeout.signal };
    const failure = Effect.runPromise(Effect.flip(forward(configured)));

    timeout.abort("controlled timeout");
    expect((await failure)._tag).toBe("ExitTimeout");
  });
});

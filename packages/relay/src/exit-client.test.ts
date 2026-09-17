import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { RelayConfig, RelayFetch } from "./config.ts";
import { ExitClient, exitClientLayer } from "./exit-client.ts";
import { MemoryRequestTracker } from "./request-tracker.ts";
import { StaticTenantAuthenticator } from "./tenant-auth.ts";

function config(fetch: RelayFetch): RelayConfig {
  return {
    hostname: "127.0.0.1",
    port: 0,
    exitUrl: new URL("https://exit.example/v1/chat/completions"),
    exitToken: "exit-token",
    authenticator: new StaticTenantAuthenticator(new Map([["tenant", "token"]])),
    requestTracker: new MemoryRequestTracker(60_000),
    maxEnvelopeBytes: 1024,
    maxConcurrentRequests: 1,
    exitTimeoutMs: 1_000,
    fetch,
  };
}

function forward(configured: RelayConfig) {
  return Effect.gen(function* () {
    const client = yield* ExitClient;
    return yield* client.forward("{}", new AbortController().signal);
  }).pipe(Effect.provide(exitClientLayer(configured)));
}

describe("Relay Exit client", () => {
  test("aborts fetch when the Effect is interrupted", async () => {
    let startFetch: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      startFetch = resolve;
    });
    let fetchWasAborted = false;
    const configured = config(
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
    const configured = config(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    configured.exitTimeoutSignal = () => timeout.signal;
    const failure = Effect.runPromise(Effect.flip(forward(configured)));

    timeout.abort("controlled timeout");
    expect((await failure)._tag).toBe("ExitTimeout");
  });
});

import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { sealRequest } from "@shallot/protocol";
import { Effect, Layer } from "effect";
import type { SidecarConfig } from "../src/config.ts";
import {
  RelayClient,
  RelayTransport,
  relayClientLayer,
  type SidecarFetch,
} from "../src/relay.ts";

async function setup(fetch: SidecarFetch): Promise<{
  config: SidecarConfig;
  fetch: SidecarFetch;
  request: Request;
  envelope: Awaited<ReturnType<typeof sealRequest>>["envelope"];
}> {
  const keys = generateKeyPairSync("x25519");
  const sealed = await sealRequest(Buffer.from("{}"), {
    exitPublicKey: keys.publicKey,
    keyId: "test-key",
    paddingBytes: 64,
  });
  return {
    config: {
      hostname: "127.0.0.1",
      port: 0,
      relayUrl: new URL("https://relay.example/v1/chat/completions"),
      exitPublicKey: keys.publicKey,
      exitKeyId: "test-key",
      requestPaddingBytes: 64,
      maxRequestBytes: 1024,
      relayTimeoutMs: 1_000,
      maxResponseLineBytes: 1024,
      maxResponseFrames: 10,
      maxResponseBytes: 1024,
    },
    fetch,
    request: new Request("http://sidecar.test/v1/chat/completions"),
    envelope: sealed.envelope,
  };
}

function forward(
  config: SidecarConfig,
  transport: RelayTransport["Service"],
  request: Request,
  envelope: Awaited<ReturnType<typeof sealRequest>>["envelope"],
) {
  return Effect.gen(function* () {
    const client = yield* RelayClient;
    return yield* client.forward(request, envelope);
  }).pipe(
    Effect.provide(
      relayClientLayer({
        url: config.relayUrl,
        timeoutMs: config.relayTimeoutMs,
      }).pipe(Layer.provide(Layer.succeed(RelayTransport, transport))),
    ),
  );
}

describe("Sidecar Relay client", () => {
  test("aborts fetch when the Effect is interrupted", async () => {
    let startFetch: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      startFetch = resolve;
    });
    let fetchWasAborted = false;
    const harness = await setup(
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
    const result = Effect.runPromise(
      forward(
        harness.config,
        { fetch: harness.fetch },
        harness.request,
        harness.envelope,
      ),
      { signal: cancellation.signal },
    );

    await started;
    cancellation.abort("test interruption");
    await expect(result).rejects.toThrow();
    expect(fetchWasAborted).toBeTrue();
  });

  test("reports an Effect timeout", async () => {
    const harness = await setup(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    const failure = await Effect.runPromise(
      Effect.flip(
        forward(
          { ...harness.config, relayTimeoutMs: 1 },
          { fetch: harness.fetch },
          harness.request,
          harness.envelope,
        ),
      ),
    );

    expect(failure._tag).toBe("RelayTimeout");
  });
});

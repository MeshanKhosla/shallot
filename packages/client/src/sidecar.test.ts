import { afterEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
  createResponseSealer,
  encodeResponseHead,
  openRequest,
  parseSealedRequest,
  sealRequest,
} from "@shallot/protocol";
import { Effect, Layer } from "effect";
import type { SidecarConfig } from "./config.ts";
import { RelayRejected } from "./errors.ts";
import { RelayClient } from "./relay.ts";
import { createBufferedResponse, createStreamingResponse } from "./response.ts";
import { createSidecarServer } from "./sidecar.ts";

const servers: Array<{
  stop(closeActiveConnections?: boolean): void | Promise<void>;
}> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop(true)));
});

type ResponseLimits = Pick<
  SidecarConfig,
  "maxResponseLineBytes" | "maxResponseFrames" | "maxResponseBytes"
>;

function setup(responsePayloads: string[], limits: Partial<ResponseLimits> = {}) {
  const exitKeys = generateKeyPairSync("x25519");
  let observedRequest: unknown;
  let observedAuthorization: string | null = null;
  let relaySawPlaintext = false;

  const relay = Bun.serve({
    port: 0,
    async fetch(req) {
      observedAuthorization = req.headers.get("authorization");
      const rawEnvelope = await req.text();
      relaySawPlaintext = rawEnvelope.includes("secret prompt");
      const envelope = parseSealedRequest(JSON.parse(rawEnvelope));
      const opened = await openRequest(envelope, exitKeys.privateKey);
      observedRequest = JSON.parse(opened.payload.toString("utf8"));
      const sealer = await createResponseSealer(
        opened.responsePublicKey,
        envelope.requestId,
      );
      const lines: string[] = [];
      const head = await sealer.sealFrame(
        encodeResponseHead({
          status: 200,
          contentType:
            responsePayloads.length > 1
              ? "text/event-stream; charset=utf-8"
              : "application/json",
        }),
        0,
        "head",
        false,
        256,
      );
      lines.push(JSON.stringify(head));
      for (const [sequence, payload] of responsePayloads.entries()) {
        const frame = await sealer.sealFrame(
          Buffer.from(payload),
          sequence + 1,
          "data",
          sequence === responsePayloads.length - 1,
          256,
        );
        lines.push(JSON.stringify(frame));
      }
      return new Response(`${lines.join("\n")}\n`, {
        headers: { "content-type": "application/x-ndjson" },
      });
    },
  });
  servers.push(relay);

  const sidecar = createSidecarServer({
    hostname: "127.0.0.1",
    port: 0,
    relayUrl: new URL(`http://127.0.0.1:${relay.port}/v1/chat/completions`),
    exitPublicKey: exitKeys.publicKey,
    exitKeyId: "local",
    requestPaddingBytes: 1024,
    maxRequestBytes: 64 * 1024,
    relayTimeoutMs: 1_000,
    maxResponseLineBytes: 64 * 1024,
    maxResponseFrames: 100,
    maxResponseBytes: 64 * 1024,
    ...limits,
  });
  servers.push(sidecar);

  return {
    url: `http://127.0.0.1:${sidecar.port}/v1/chat/completions`,
    observations: () => ({
      observedRequest,
      observedAuthorization,
      relaySawPlaintext,
    }),
  };
}

function setupMalformedRelay(body: string, maxResponseLineBytes = 64 * 1024) {
  const exitKeys = generateKeyPairSync("x25519");
  const relay = Bun.serve({
    port: 0,
    fetch() {
      return new Response(body, {
        headers: { "content-type": "application/x-ndjson" },
      });
    },
  });
  servers.push(relay);

  const sidecar = createSidecarServer({
    hostname: "127.0.0.1",
    port: 0,
    relayUrl: new URL(`http://127.0.0.1:${relay.port}/v1/chat/completions`),
    exitPublicKey: exitKeys.publicKey,
    exitKeyId: "local",
    requestPaddingBytes: 1024,
    maxRequestBytes: 64 * 1024,
    relayTimeoutMs: 1_000,
    maxResponseLineBytes,
    maxResponseFrames: 100,
    maxResponseBytes: 64 * 1024,
  });
  servers.push(sidecar);
  return `http://127.0.0.1:${sidecar.port}/v1/chat/completions`;
}

async function postChat(url: string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "example-model",
      messages: [{ role: "user", content: "secret prompt" }],
    }),
  });
}

describe("sidecar", () => {
  test("uses a replacement RelayClient Layer", async () => {
    const exitKeys = generateKeyPairSync("x25519");
    let forwarded = false;
    const config: SidecarConfig = {
      hostname: "127.0.0.1",
      port: 0,
      relayUrl: new URL("https://unused.example/v1/chat/completions"),
      exitPublicKey: exitKeys.publicKey,
      exitKeyId: "local",
      requestPaddingBytes: 1024,
      maxRequestBytes: 64 * 1024,
      relayTimeoutMs: 1_000,
      maxResponseLineBytes: 64 * 1024,
      maxResponseFrames: 100,
      maxResponseBytes: 64 * 1024,
    };
    const relay = Layer.succeed(RelayClient, {
      forward() {
        forwarded = true;
        return Effect.fail(new RelayRejected({ status: 418 }));
      },
    });
    const sidecar = createSidecarServer(config, relay);
    servers.push(sidecar);

    const response = await postChat(
      `http://127.0.0.1:${sidecar.port}/v1/chat/completions`,
    );

    expect(response.status).toBe(418);
    expect(forwarded).toBeTrue();
  });

  test("seals a chat request and decrypts a buffered response", async () => {
    const harness = setup([
      JSON.stringify({
        id: "chatcmpl_1",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "hello" } }],
      }),
    ]);
    const request = {
      model: "example-model",
      messages: [{ role: "user", content: "secret prompt" }],
    };

    const response = await fetch(harness.url, {
      method: "POST",
      headers: {
        authorization: "Bearer tenant-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: "chatcmpl_1",
      object: "chat.completion",
      choices: [{ message: { role: "assistant", content: "hello" } }],
    });
    expect(harness.observations()).toEqual({
      observedRequest: request,
      observedAuthorization: "Bearer tenant-token",
      relaySawPlaintext: false,
    });
  });

  test("decrypts response frames into an SSE stream", async () => {
    const first = 'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n';
    const second = 'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n';
    const harness = setup([first, second]);

    const response = await fetch(harness.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "example-model",
        messages: [{ role: "user", content: "secret prompt" }],
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await response.text()).toBe(first + second);
  });

  test("rejects unsupported routes", async () => {
    const harness = setup(["{}"]);
    const response = await fetch(harness.url.replace("/v1/chat/completions", "/health"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        message: "only POST /v1/chat/completions",
        type: "not_found_error",
      },
    });
  });

  test("rejects non-JSON request content", async () => {
    const harness = setup(["{}"]);
    const response = await fetch(harness.url, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });

    expect(response.status).toBe(415);
  });

  test("rejects malformed encrypted response framing", async () => {
    const response = await postChat(setupMalformedRelay("not-json\n"));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: {
        message: "Relay returned an invalid encrypted response",
        type: "upstream_error",
      },
    });
  });

  test("rejects an encrypted response line over the configured limit", async () => {
    const response = await postChat(setupMalformedRelay(`${"x".repeat(65)}\n`, 64));

    expect(response.status).toBe(502);
  });

  test("rejects an encrypted response over the frame limit", async () => {
    const harness = setup(["{}"], { maxResponseFrames: 1 });
    const response = await postChat(harness.url);

    expect(response.status).toBe(502);
  });

  test("cancels the encrypted upstream when a streaming client stops", async () => {
    const exitKeys = generateKeyPairSync("x25519");
    const sealed = await sealRequest(Buffer.from("{}"), {
      exitPublicKey: exitKeys.publicKey,
      keyId: "local",
      paddingBytes: 64,
    });
    const opened = await openRequest(sealed.envelope, exitKeys.privateKey);
    const sealer = await createResponseSealer(
      opened.responsePublicKey,
      sealed.envelope.requestId,
    );
    const head = await sealer.sealFrame(
      encodeResponseHead({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
      }),
      0,
      "head",
      false,
      256,
    );
    let cancelled = false;
    const relayBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from(`${JSON.stringify(head)}\n`));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = await createStreamingResponse(
      relayBody,
      sealed.responsePrivateKey,
      sealed.envelope.requestId,
      {
        hostname: "127.0.0.1",
        port: 0,
        relayUrl: new URL("http://127.0.0.1"),
        exitPublicKey: exitKeys.publicKey,
        exitKeyId: "local",
        requestPaddingBytes: 64,
        maxRequestBytes: 1024,
        relayTimeoutMs: 1_000,
        maxResponseLineBytes: 1024,
        maxResponseFrames: 10,
        maxResponseBytes: 1024,
      },
    );

    await response.body?.cancel("test cancellation");

    expect(cancelled).toBeTrue();
  });

  test("cancels the encrypted upstream after an invalid response head", async () => {
    const exitKeys = generateKeyPairSync("x25519");
    const sealed = await sealRequest(Buffer.from("{}"), {
      exitPublicKey: exitKeys.publicKey,
      keyId: "local",
      paddingBytes: 64,
    });
    const opened = await openRequest(sealed.envelope, exitKeys.privateKey);
    const sealer = await createResponseSealer(
      opened.responsePublicKey,
      sealed.envelope.requestId,
    );
    const invalidHead = await sealer.sealFrame(
      Buffer.from("not a response head"),
      0,
      "head",
      false,
      256,
    );
    let cancelled = false;
    const relayBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from(`${JSON.stringify(invalidHead)}\n`));
      },
      cancel() {
        cancelled = true;
      },
    });
    const config: SidecarConfig = {
      hostname: "127.0.0.1",
      port: 0,
      relayUrl: new URL("http://127.0.0.1"),
      exitPublicKey: exitKeys.publicKey,
      exitKeyId: "local",
      requestPaddingBytes: 64,
      maxRequestBytes: 1024,
      relayTimeoutMs: 1_000,
      maxResponseLineBytes: 1024,
      maxResponseFrames: 10,
      maxResponseBytes: 1024,
    };

    await expect(
      createBufferedResponse(
        relayBody,
        sealed.responsePrivateKey,
        sealed.envelope.requestId,
        config,
      ),
    ).rejects.toThrow("invalid encrypted response");
    expect(cancelled).toBeTrue();
  });

  test("cancels the Relay request when an HTTP streaming client stops", async () => {
    const exitKeys = generateKeyPairSync("x25519");
    let relayCancelled = false;
    let resolveCancellation: (() => void) | undefined;
    const cancellation = new Promise<void>((resolve) => {
      resolveCancellation = resolve;
    });
    const relay = Bun.serve({
      port: 0,
      async fetch(req) {
        const envelope = parseSealedRequest(await req.json());
        const opened = await openRequest(envelope, exitKeys.privateKey);
        const sealer = await createResponseSealer(
          opened.responsePublicKey,
          envelope.requestId,
        );
        const head = await sealer.sealFrame(
          encodeResponseHead({
            status: 200,
            contentType: "text/event-stream; charset=utf-8",
          }),
          0,
          "head",
          false,
          256,
        );
        const data = await sealer.sealFrame(
          Buffer.from('data: {"choices":[]}\n\n'),
          1,
          "data",
          false,
          256,
        );
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                Buffer.from(`${JSON.stringify(head)}\n${JSON.stringify(data)}\n`),
              );
            },
            cancel() {
              relayCancelled = true;
              resolveCancellation?.();
            },
          }),
        );
      },
    });
    servers.push(relay);
    const sidecar = createSidecarServer({
      hostname: "127.0.0.1",
      port: 0,
      relayUrl: new URL(`http://127.0.0.1:${relay.port}/v1/chat/completions`),
      exitPublicKey: exitKeys.publicKey,
      exitKeyId: "local",
      requestPaddingBytes: 1024,
      maxRequestBytes: 64 * 1024,
      relayTimeoutMs: 1_000,
      maxResponseLineBytes: 64 * 1024,
      maxResponseFrames: 100,
      maxResponseBytes: 64 * 1024,
    });
    servers.push(sidecar);

    const response = await fetch(`http://127.0.0.1:${sidecar.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "example-model",
        messages: [{ role: "user", content: "secret prompt" }],
        stream: true,
      }),
    });
    const reader = response.body?.getReader();
    expect((await reader?.read())?.done).toBeFalse();
    await reader?.cancel("client stopped");

    expect(
      await Promise.race([
        cancellation.then(() => "cancelled" as const),
        Bun.sleep(100).then(() => "timed out" as const),
      ]),
    ).toBe("cancelled");
    expect(relayCancelled).toBeTrue();
  });
});

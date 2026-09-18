import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import {
  createResponseOpener,
  decodeResponseHead,
  parseSealedFrame,
  type ResponseHead,
  SEALED_STREAM_CONTENT_TYPE,
  type SealedRequest,
  sealRequest,
} from "@shallot/protocol";
import { Effect, Layer, Redacted } from "effect";
import type { ExitConfig } from "../src/config.ts";
import { ProviderTimeout } from "../src/errors.ts";
import { createExitServer } from "../src/exit.ts";
import { LlmProvider, type LlmProviderService } from "../src/llm-provider.ts";
import { ReplayProtection, replayProtectionLayer } from "../src/replay-protection.ts";

const servers: Array<{ stop(closeActiveConnections?: boolean): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop(true)));
});

const VALID_PAYLOAD = Buffer.from(
  JSON.stringify({
    model: "test-model",
    messages: [{ role: "user", content: "secret" }],
  }),
);

async function sealedRequest(
  payload: Uint8Array = VALID_PAYLOAD,
  exitKeys: { publicKey: KeyObject; privateKey: KeyObject } = generateKeyPairSync(
    "x25519",
  ),
): Promise<{
  body: string;
  envelope: SealedRequest;
  privateKeys: Map<string, KeyObject>;
  responsePrivateKey: CryptoKey;
}> {
  const sealed = await sealRequest(payload, {
    exitPublicKey: exitKeys.publicKey,
    keyId: "test-key",
    paddingBytes: 256,
  });
  return {
    body: JSON.stringify(sealed.envelope),
    envelope: sealed.envelope,
    privateKeys: new Map([["test-key", exitKeys.privateKey]]),
    responsePrivateKey: sealed.responsePrivateKey,
  };
}

function config(privateKeys: Map<string, KeyObject>): ExitConfig {
  return {
    hostname: "127.0.0.1",
    port: 0,
    relayToken: Redacted.make("relay-token"),
    privateKeys,
    maxEnvelopeBytes: 4096,
    responsePaddingBytes: 256,
    responseFlushMs: 1,
    replayTtlMs: 60_000,
    replayMaxEntries: 100,
  };
}

function services(
  provider: LlmProviderService,
  replayProtection: Layer.Layer<ReplayProtection> = replayProtectionLayer({
    ttlMs: 60_000,
    maxEntries: 100,
  }),
) {
  return Layer.mergeAll(Layer.succeed(LlmProvider, provider), replayProtection);
}

function post(server: { port?: number }, body: string): Promise<Response> {
  if (server.port === undefined) throw new Error("test server has no port");
  return fetch(`http://127.0.0.1:${server.port}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: "Bearer relay-token" },
    body,
  });
}

async function decryptSealedResponse(
  response: Response,
  responsePrivateKey: CryptoKey,
  requestId: string,
): Promise<{ head: ResponseHead; body: string }> {
  expect(response.headers.get("content-type")).toBe(SEALED_STREAM_CONTENT_TYPE);
  const text = await response.text();
  const frames = text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => parseSealedFrame(JSON.parse(line)));
  const headFrame = frames[0];
  if (headFrame === undefined) throw new Error("response has no head frame");
  if (headFrame.encapsulatedKey === undefined) {
    throw new Error("response head frame has no encapsulated key");
  }
  const opener = await createResponseOpener(
    responsePrivateKey,
    requestId,
    headFrame.encapsulatedKey,
  );
  const payloads: Buffer[] = [];
  let sequence = 0;
  for (const frame of frames) {
    payloads.push(await opener.openFrame(frame, sequence));
    sequence += 1;
  }
  const headPayload = payloads[0];
  if (headPayload === undefined) throw new Error("response has no head frame");
  return {
    head: decodeResponseHead(headPayload),
    body: Buffer.concat(payloads.slice(1)).toString("utf8"),
  };
}

function tamperCiphertext(ciphertext: string): string {
  const index = ciphertext.search(/[A-Za-z]/);
  const original = index === -1 ? undefined : ciphertext[index];
  if (original === undefined) throw new Error("ciphertext has no alphabetic character");
  const flipped = original === "a" ? "b" : "a";
  return `${ciphertext.slice(0, index)}${flipped}${ciphertext.slice(index + 1)}`;
}

function provider(): LlmProviderService {
  return {
    policy: { allowedModels: new Set(["test-model"]), maxResponseBytes: 1024 },
    complete: () => Effect.succeed(Response.json({ choices: [] })),
  };
}

describe("Exit Effect runtime", () => {
  test("runs with only injected provider and replay dependencies", async () => {
    const sealed = await sealedRequest();
    let providerCalled = false;
    const provider: LlmProviderService = {
      policy: {
        allowedModels: new Set(["test-model"]),
        maxResponseBytes: 1024,
      },
      complete: () => {
        providerCalled = true;
        return Effect.succeed(Response.json({ choices: [] }));
      },
    };
    const server = createExitServer(config(sealed.privateKeys), services(provider));
    servers.push(server);

    const response = await post(server, sealed.body);
    const encryptedBody = await response.text();

    expect(response.status).toBe(200);
    expect(providerCalled).toBeTrue();
    expect(encryptedBody).not.toContain("choices");
  });

  test("converts an unexpected service defect without leaking it", async () => {
    const sealed = await sealedRequest();
    const replayProtection = Layer.succeed(ReplayProtection, {
      claim: () => Effect.die(new Error("private-key-canary")),
    });
    const server = createExitServer(
      config(sealed.privateKeys),
      services(provider(), replayProtection),
    );
    servers.push(server);

    const response = await post(server, sealed.body);
    const responseBody = await response.text();

    expect(response.status).toBe(500);
    expect(responseBody).toContain("Exit request failed");
    expect(responseBody).not.toContain("private-key-canary");
  });

  test("seals a 400 for an invalid JSON payload without reporting a defect", async () => {
    const errorSpy = spyOn(console, "error");
    try {
      const sealed = await sealedRequest(Buffer.from("{ not valid json"));
      const server = createExitServer(config(sealed.privateKeys), services(provider()));
      servers.push(server);

      const response = await post(server, sealed.body);
      const { head, body } = await decryptSealedResponse(
        response,
        sealed.responsePrivateKey,
        sealed.envelope.requestId,
      );

      expect(head.status).toBe(400);
      expect(JSON.parse(body)).toEqual({
        error: {
          message: "Decrypted request is not valid JSON",
          type: "invalid_request_error",
        },
      });
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("seals a 409 for a replayed encrypted request", async () => {
    const sealed = await sealedRequest();
    const server = createExitServer(config(sealed.privateKeys), services(provider()));
    servers.push(server);

    const first = await post(server, sealed.body);
    expect(first.status).toBe(200);
    await first.body?.cancel();

    const second = await post(server, sealed.body);
    const { head, body } = await decryptSealedResponse(
      second,
      sealed.responsePrivateKey,
      sealed.envelope.requestId,
    );

    expect(second.status).toBe(200);
    expect(head.status).toBe(409);
    expect(JSON.parse(body)).toEqual({
      error: {
        message: "Encrypted request was replayed",
        type: "replay_error",
      },
    });
  });

  test("does not consume replay state when the HPKE envelope cannot be opened", async () => {
    const sealed = await sealedRequest();
    const server = createExitServer(config(sealed.privateKeys), services(provider()));
    servers.push(server);

    const tampered = {
      ...sealed.envelope,
      ciphertext: tamperCiphertext(sealed.envelope.ciphertext),
    };
    const invalid = await post(server, JSON.stringify(tampered));
    expect(invalid.status).toBe(400);

    const valid = await post(server, sealed.body);
    expect(valid.status).toBe(200);
  });

  test("seals a 503 when the replay cache is exhausted", async () => {
    const exitKeys = generateKeyPairSync("x25519");
    const sealed = await sealedRequest(VALID_PAYLOAD, exitKeys);
    const other = await sealedRequest(VALID_PAYLOAD, exitKeys);
    const exhaust = replayProtectionLayer({ ttlMs: 60_000, maxEntries: 1 });
    const server = createExitServer(
      config(sealed.privateKeys),
      services(provider(), exhaust),
    );
    servers.push(server);

    const first = await post(server, sealed.body);
    expect(first.status).toBe(200);
    await first.body?.cancel();

    const second = await post(server, other.body);
    const { head, body } = await decryptSealedResponse(
      second,
      other.responsePrivateKey,
      other.envelope.requestId,
    );

    expect(second.status).toBe(200);
    expect(head.status).toBe(503);
    expect(JSON.parse(body)).toEqual({
      error: {
        message: "Exit replay cache is full",
        type: "overloaded_error",
      },
    });
  });

  test("rejects relay authentication failures with a plaintext 401", async () => {
    const sealed = await sealedRequest();
    const server = createExitServer(config(sealed.privateKeys), services(provider()));
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: "Bearer wrong-token" },
      body: sealed.body,
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { type: "authentication_error" },
    });
  });

  test("rejects a malformed envelope with a plaintext 400", async () => {
    const server = createExitServer(config(new Map()), services(provider()));
    servers.push(server);

    const response = await post(server, JSON.stringify({ not: "an envelope" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { type: "invalid_request_error" },
    });
  });

  test("rejects an oversized envelope with a plaintext 413", async () => {
    const sealed = await sealedRequest();
    const server = createExitServer(config(sealed.privateKeys), services(provider()));
    servers.push(server);

    const response = await post(server, "x".repeat(5000));

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { type: "request_too_large" } });
  });

  test("seals the intended 504 for a provider timeout", async () => {
    const sealed = await sealedRequest();
    const timedOut: LlmProviderService = {
      policy: { allowedModels: new Set(["test-model"]), maxResponseBytes: 1024 },
      complete: () => Effect.fail(new ProviderTimeout()),
    };
    const server = createExitServer(config(sealed.privateKeys), services(timedOut));
    servers.push(server);

    const response = await post(server, sealed.body);
    const { head, body } = await decryptSealedResponse(
      response,
      sealed.responsePrivateKey,
      sealed.envelope.requestId,
    );

    expect(head).toMatchObject({ status: 504, contentType: "application/json" });
    expect(JSON.parse(body)).toEqual({
      error: { message: "AI provider timed out", type: "provider_error" },
    });
  });
});

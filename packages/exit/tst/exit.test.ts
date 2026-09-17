import { afterEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { sealRequest } from "@shallot/protocol";
import { Effect, Layer } from "effect";
import type { ExitConfig } from "../src/config.ts";
import { createExitServer } from "../src/exit.ts";
import { LlmProvider, type LlmProviderService } from "../src/llm-provider.ts";
import { MemoryReplayCache, type ReplayCache } from "../src/replay-cache.ts";
import { replayProtectionLayer } from "../src/replay-protection.ts";

const servers: Array<{ stop(closeActiveConnections?: boolean): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop(true)));
});

async function sealedRequest(): Promise<{
  body: string;
  privateKeys: Map<string, KeyObject>;
}> {
  const keyPair = generateKeyPairSync("x25519");
  const sealed = await sealRequest(
    Buffer.from(
      JSON.stringify({
        model: "test-model",
        messages: [{ role: "user", content: "secret" }],
      }),
    ),
    { exitPublicKey: keyPair.publicKey, keyId: "test-key", paddingBytes: 256 },
  );
  return {
    body: JSON.stringify(sealed.envelope),
    privateKeys: new Map([["test-key", keyPair.privateKey]]),
  };
}

function config(privateKeys: Map<string, KeyObject>): ExitConfig {
  return {
    hostname: "127.0.0.1",
    port: 0,
    relayToken: "relay-token",
    privateKeys,
    llm: {
      url: new URL("https://provider.example/v1/chat/completions"),
      timeoutMs: 1_000,
      allowedModels: new Set(["test-model"]),
      maxResponseBytes: 1024,
    },
    maxEnvelopeBytes: 4096,
    responsePaddingBytes: 256,
    responseFlushMs: 1,
    replayTtlMs: 60_000,
    replayMaxEntries: 100,
  };
}

function services(
  provider: LlmProviderService,
  replayCache: ReplayCache = new MemoryReplayCache(60_000),
) {
  return Layer.mergeAll(
    Layer.succeed(LlmProvider, provider),
    replayProtectionLayer(replayCache),
  );
}

describe("Exit Effect runtime", () => {
  test("runs with only injected provider and replay dependencies", async () => {
    const sealed = await sealedRequest();
    let providerCalled = false;
    const provider: LlmProviderService = {
      complete: () => {
        providerCalled = true;
        return Effect.succeed(Response.json({ choices: [] }));
      },
    };
    const server = createExitServer(config(sealed.privateKeys), services(provider));
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: "Bearer relay-token",
        "content-type": "application/json",
      },
      body: sealed.body,
    });
    const encryptedBody = await response.text();

    expect(response.status).toBe(200);
    expect(providerCalled).toBeTrue();
    expect(encryptedBody).not.toContain("choices");
  });

  test("converts an unexpected service defect without leaking it", async () => {
    const sealed = await sealedRequest();
    const provider: LlmProviderService = {
      complete: () => Effect.succeed(Response.json({ choices: [] })),
    };
    const replayCache: ReplayCache = {
      claim() {
        throw new Error("private-key-canary");
      },
    };
    const server = createExitServer(
      config(sealed.privateKeys),
      services(provider, replayCache),
    );
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: "Bearer relay-token" },
      body: sealed.body,
    });
    const responseBody = await response.text();

    expect(response.status).toBe(500);
    expect(responseBody).toContain("Exit request failed");
    expect(responseBody).not.toContain("private-key-canary");
  });
});

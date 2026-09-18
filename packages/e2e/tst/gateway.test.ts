import { afterEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createSidecarServer } from "@shallot/client";
import { createExitServer, exitLive, openAICompatibleProviderLive } from "@shallot/exit";
import {
  createMockProviderServer,
  type ProviderObservation,
} from "@shallot/mock-provider";
import {
  createRelayServer,
  type RelayObservation,
  relayLive,
  relayObserverLayer,
} from "@shallot/relay";
import { launchHttpServer } from "@shallot/server-runtime";
import { generateText, Output, stepCountIs, streamText, tool } from "ai";
import { Redacted } from "effect";
import { z } from "zod";

const TENANT_TOKEN = "tenant-canary-secret";
const EXIT_TOKEN = "relay-to-exit-secret";
const PROVIDER_TOKEN = "exit-to-provider-secret";
const servers: Array<{
  stop(closeActiveConnections?: boolean): void | Promise<void>;
}> = [];

function itemAt<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`missing test item at index ${index}`);
  return item;
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .reverse()
      .map((server) => server.stop(true)),
  );
});

async function setupGateway(options: { providerChunkDelayMs?: number } = {}) {
  const relayObservations: RelayObservation[] = [];
  const relayResponseChunks: Uint8Array[] = [];
  const providerObservations: ProviderObservation[] = [];
  let resolveProviderRequest: (() => void) | undefined;
  const providerRequest = new Promise<void>((resolve) => {
    resolveProviderRequest = resolve;
  });
  let resolveProviderCancellation: (() => void) | undefined;
  const providerCancellation = new Promise<void>((resolve) => {
    resolveProviderCancellation = resolve;
  });
  const exitKeys = generateKeyPairSync("x25519");

  const provider = await launchHttpServer(
    createMockProviderServer(
      {
        hostname: "127.0.0.1",
        port: 0,
        expectedApiKey: Redacted.make(PROVIDER_TOKEN),
        chunkDelayMs: options.providerChunkDelayMs ?? 1,
      },
      {
        observe: (observation) => {
          providerObservations.push(observation);
          resolveProviderRequest?.();
        },
        observeCancellation: () => resolveProviderCancellation?.(),
      },
    ),
  );
  servers.push(provider);

  const exitConfig = {
    hostname: "127.0.0.1",
    port: 0,
    relayToken: Redacted.make(EXIT_TOKEN),
    privateKeys: new Map([["test-key", exitKeys.privateKey]]),
    maxEnvelopeBytes: 256 * 1024,
    responsePaddingBytes: 512,
    responseFlushMs: 1,
    replayTtlMs: 60_000,
    replayMaxEntries: 10_000,
  };
  const providerLayer = openAICompatibleProviderLive({
    url: new URL(`http://127.0.0.1:${provider.port}/v1/chat/completions`),
    apiKey: Redacted.make(PROVIDER_TOKEN),
    timeoutMs: 5_000,
    policy: {
      allowedModels: new Set([
        "mock-text",
        "mock-stream",
        "mock-tool",
        "mock-json",
        "mock-error",
      ]),
      maxResponseBytes: 256 * 1024,
    },
  });
  const exit = await launchHttpServer(
    createExitServer(exitConfig, exitLive(exitConfig, providerLayer)),
  );
  servers.push(exit);

  const relayConfig = {
    hostname: "127.0.0.1",
    port: 0,
    exitUrl: new URL(`http://127.0.0.1:${exit.port}/v1/chat/completions`),
    exitToken: Redacted.make(EXIT_TOKEN),
    tenantTokens: new Map([["tenant-one", Redacted.make(TENANT_TOKEN)]]),
    requestTtlMs: 60_000,
    maxRequestEntries: 10_000,
    maxRequestEntriesPerTenant: 1_000,
    maxEnvelopeBytes: 256 * 1024,
    maxConcurrentRequests: 10,
    exitTimeoutMs: 1_000,
  };
  const relay = await launchHttpServer(
    createRelayServer(
      relayConfig,
      relayLive(
        relayConfig,
        relayObserverLayer({
          observeRequest: (observation) => relayObservations.push(observation),
          observeResponseChunk: (chunk) => relayResponseChunks.push(chunk.slice()),
        }),
      ),
    ),
  );
  servers.push(relay);

  const sidecar = await launchHttpServer(
    createSidecarServer({
      hostname: "127.0.0.1",
      port: 0,
      relayUrl: new URL(`http://127.0.0.1:${relay.port}/v1/chat/completions`),
      exitPublicKey: exitKeys.publicKey,
      exitKeyId: "test-key",
      requestPaddingBytes: 1024,
      maxRequestBytes: 64 * 1024,
      relayTimeoutMs: 1_000,
      maxResponseLineBytes: 64 * 1024,
      maxResponseFrames: 100,
      maxResponseBytes: 256 * 1024,
    }),
  );
  servers.push(sidecar);

  const shallot = createOpenAICompatible({
    name: "shallot",
    baseURL: `http://127.0.0.1:${sidecar.port}/v1`,
    apiKey: TENANT_TOKEN,
    includeUsage: true,
    supportsStructuredOutputs: true,
  });

  return {
    shallot,
    sidecarUrl: `http://127.0.0.1:${sidecar.port}/v1/chat/completions`,
    relayUrl: `http://127.0.0.1:${relay.port}/v1/chat/completions`,
    exitUrl: `http://127.0.0.1:${exit.port}/v1/chat/completions`,
    relayObservations,
    relayResponseText: () => Buffer.concat(relayResponseChunks).toString("utf8"),
    providerObservations,
    providerRequest,
    providerCancellation,
  };
}

describe("AI SDK through Shallot", () => {
  test("generates text without exposing identity and content together", async () => {
    const gateway = await setupGateway();
    const prompt = "prompt-canary: return the configured response";

    const result = await generateText({
      model: gateway.shallot.chatModel("mock-text"),
      prompt,
      providerOptions: {
        shallot: { user: "removable-user-marker" },
      },
    });

    expect(result.text).toBe("deterministic-response");
    expect(gateway.relayObservations).toHaveLength(1);
    expect(gateway.providerObservations).toHaveLength(1);

    const relay = itemAt(gateway.relayObservations, 0);
    expect(relay.tenantId).toBe("tenant-one");
    expect(relay.body).not.toContain(prompt);
    expect(relay.body).not.toContain(TENANT_TOKEN);
    expect(relay.body).not.toContain("deterministic-response");
    expect(gateway.relayResponseText()).not.toContain("deterministic-response");
    expect(relay.forwardedHeaders.get("authorization")).toBe(`Bearer ${EXIT_TOKEN}`);

    const provider = itemAt(gateway.providerObservations, 0);
    expect(JSON.stringify(provider.request)).toContain(prompt);
    expect(JSON.stringify(provider.request)).not.toContain(TENANT_TOKEN);
    expect(JSON.stringify(provider.request)).not.toContain("removable-user-marker");
    expect(provider.authorization).toBe(`Bearer ${PROVIDER_TOKEN}`);
  });

  test("streams text through encrypted padded frames", async () => {
    const gateway = await setupGateway();
    const result = streamText({
      model: gateway.shallot.chatModel("mock-stream"),
      prompt: "stream the deterministic response",
    });

    let text = "";
    for await (const part of result.textStream) text += part;

    expect(text).toBe("deterministic-response");
    expect(gateway.relayObservations).toHaveLength(1);
    expect(gateway.relayResponseText()).not.toContain(text);
  });

  test("cancels the provider when the AI SDK client disconnects", async () => {
    const gateway = await setupGateway({ providerChunkDelayMs: 1_000 });
    const cancellation = new AbortController();
    const result = streamText({
      model: gateway.shallot.chatModel("mock-stream"),
      prompt: "cancel this generation",
      abortSignal: cancellation.signal,
    });
    const consume = (async () => {
      for await (const _part of result.textStream) {
        // Consumption keeps the HTTP body active until the abort below.
      }
    })();

    await gateway.providerRequest;
    cancellation.abort("AI SDK client stopped");
    await consume.catch(() => undefined);

    expect(
      await Promise.race([
        gateway.providerCancellation.then(() => "cancelled" as const),
        Bun.sleep(500).then(() => "timed out" as const),
      ]),
    ).toBe("cancelled");
  });

  test("supports an AI SDK tool round trip", async () => {
    const gateway = await setupGateway();
    const result = await generateText({
      model: gateway.shallot.chatModel("mock-tool"),
      prompt: "What is the weather in Paris?",
      tools: {
        weather: tool({
          description: "Return deterministic test weather",
          inputSchema: z.object({ city: z.string() }),
          execute: async ({ city }) => ({ city, condition: "sunny" }),
        }),
      },
      stopWhen: stepCountIs(2),
    });

    expect(result.text).toBe("The tool returned sunny.");
    expect(gateway.providerObservations).toHaveLength(2);
    expect(JSON.stringify(itemAt(gateway.providerObservations, 1).request)).toContain(
      "sunny",
    );
  });

  test("supports structured output", async () => {
    const gateway = await setupGateway();
    const result = await generateText({
      model: gateway.shallot.chatModel("mock-json"),
      prompt: "Return structured output",
      output: Output.object({
        schema: z.object({ answer: z.string() }),
      }),
    });

    expect(result.output).toEqual({ answer: "structured-response" });
  });

  test("returns encrypted provider errors to the AI SDK", async () => {
    const gateway = await setupGateway();
    const operation = generateText({
      model: gateway.shallot.chatModel("mock-error"),
      prompt: "trigger the configured provider error",
      maxRetries: 0,
    });

    await expect(operation).rejects.toThrow("configured provider error");
    expect(gateway.relayObservations).toHaveLength(1);
    expect(itemAt(gateway.relayObservations, 0).body).not.toContain(
      "configured provider error",
    );
    expect(gateway.relayResponseText()).not.toContain("configured provider error");
  });

  test("rejects an invalid tenant token before the Exit", async () => {
    const gateway = await setupGateway();
    const response = await fetch(gateway.sidecarUrl, {
      method: "POST",
      headers: {
        authorization: "Bearer wrong-tenant-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "mock-text",
        messages: [{ role: "user", content: "must not reach the Exit" }],
      }),
    });

    expect(response.status).toBe(401);
    expect(gateway.relayObservations).toHaveLength(0);
    expect(gateway.providerObservations).toHaveLength(0);
  });

  test("rejects replayed envelopes at the Relay and Exit", async () => {
    const gateway = await setupGateway();
    await generateText({
      model: gateway.shallot.chatModel("mock-text"),
      prompt: "create one envelope",
    });
    const envelope = itemAt(gateway.relayObservations, 0).body;

    const relayReplay = await fetch(gateway.relayUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TENANT_TOKEN}`,
        "content-type": "application/json",
      },
      body: envelope,
    });
    expect(relayReplay.status).toBe(409);

    const exitReplay = await fetch(gateway.exitUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${EXIT_TOKEN}`,
        "content-type": "application/json",
      },
      body: envelope,
    });
    expect(exitReplay.status).toBe(200);
    expect(exitReplay.headers.get("content-type")).toBe("application/x-ndjson");
    expect(gateway.providerObservations).toHaveLength(1);
  });
});

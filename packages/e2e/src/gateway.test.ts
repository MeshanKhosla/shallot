import { afterEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createSidecarServer } from "@shallot/client";
import { createExitServer, MemoryReplayCache } from "@shallot/exit";
import {
  createMockProviderServer,
  type ProviderObservation,
} from "@shallot/mock-provider";
import {
  createRelayServer,
  MemoryRequestTracker,
  type RelayObservation,
  StaticTenantAuthenticator,
} from "@shallot/relay";
import { generateText, Output, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";

const TENANT_TOKEN = "tenant-canary-secret";
const EXIT_TOKEN = "relay-to-exit-secret";
const PROVIDER_TOKEN = "exit-to-provider-secret";
const servers: Array<{ stop(closeActiveConnections?: boolean): void }> = [];

function itemAt<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`missing test item at index ${index}`);
  return item;
}

afterEach(() => {
  for (const server of servers.splice(0).reverse()) server.stop(true);
});

function setupGateway() {
  const relayObservations: RelayObservation[] = [];
  const providerObservations: ProviderObservation[] = [];
  const exitKeys = generateKeyPairSync("x25519");

  const provider = createMockProviderServer({
    port: 0,
    expectedApiKey: PROVIDER_TOKEN,
    chunkDelayMs: 1,
    observe: (observation) => providerObservations.push(observation),
  });
  servers.push(provider);

  const exit = createExitServer({
    port: 0,
    relayToken: EXIT_TOKEN,
    privateKeys: new Map([["test-key", exitKeys.privateKey]]),
    providerUrl: new URL(`http://127.0.0.1:${provider.port}/v1/chat/completions`),
    providerApiKey: PROVIDER_TOKEN,
    allowedModels: new Set([
      "mock-text",
      "mock-stream",
      "mock-tool",
      "mock-json",
      "mock-error",
    ]),
    maxEnvelopeBytes: 256 * 1024,
    responsePaddingBytes: 512,
    responseFlushMs: 1,
    maxProviderResponseBytes: 256 * 1024,
    providerTimeoutMs: 5_000,
    replayCache: new MemoryReplayCache(60_000),
    fetch,
  });
  servers.push(exit);

  const relay = createRelayServer({
    port: 0,
    exitUrl: new URL(`http://127.0.0.1:${exit.port}/v1/chat/completions`),
    exitToken: EXIT_TOKEN,
    authenticator: new StaticTenantAuthenticator(new Map([["tenant-one", TENANT_TOKEN]])),
    requestTracker: new MemoryRequestTracker(60_000),
    maxEnvelopeBytes: 256 * 1024,
    maxConcurrentRequests: 10,
    fetch,
    observe: (observation) => relayObservations.push(observation),
  });
  servers.push(relay);

  const sidecar = createSidecarServer({
    port: 0,
    relayUrl: new URL(`http://127.0.0.1:${relay.port}/v1/chat/completions`),
    exitPublicKey: exitKeys.publicKey,
    exitKeyId: "test-key",
    requestPaddingBytes: 1024,
    maxRequestBytes: 64 * 1024,
  });
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
    relayObservations,
    providerObservations,
  };
}

describe("AI SDK through Shallot", () => {
  test("generates text without exposing identity and content together", async () => {
    const gateway = setupGateway();
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
    expect(relay.forwardedHeaders.get("authorization")).toBe(`Bearer ${EXIT_TOKEN}`);

    const provider = itemAt(gateway.providerObservations, 0);
    expect(JSON.stringify(provider.request)).toContain(prompt);
    expect(JSON.stringify(provider.request)).not.toContain(TENANT_TOKEN);
    expect(JSON.stringify(provider.request)).not.toContain("removable-user-marker");
    expect(provider.authorization).toBe(`Bearer ${PROVIDER_TOKEN}`);
  });

  test("streams text through encrypted padded frames", async () => {
    const gateway = setupGateway();
    const result = streamText({
      model: gateway.shallot.chatModel("mock-stream"),
      prompt: "stream the deterministic response",
    });

    let text = "";
    for await (const part of result.textStream) text += part;

    expect(text).toBe("deterministic-response");
    expect(gateway.relayObservations).toHaveLength(1);
    expect(itemAt(gateway.relayObservations, 0).body).not.toContain(text);
  });

  test("supports an AI SDK tool round trip", async () => {
    const gateway = setupGateway();
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
    const gateway = setupGateway();
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
    const gateway = setupGateway();
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
  });
});

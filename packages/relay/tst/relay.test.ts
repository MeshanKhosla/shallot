import { afterEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { sealRequest } from "@shallot/protocol";
import { launchHttpServer } from "@shallot/server-runtime";
import { Layer, Redacted } from "effect";
import { concurrencyLimiterLayer } from "../src/concurrency-limiter.ts";
import type { RelayConfig } from "../src/config.ts";
import { ExitTransport, exitClientLayer, type RelayFetch } from "../src/exit-client.ts";
import { createRelayServer } from "../src/relay.ts";
import { relayObserverNoop } from "../src/relay-observer.ts";
import { requestTrackerLayer } from "../src/request-tracker.ts";
import { tenantAuthenticatorLayer } from "../src/tenant-auth.ts";

const servers: Array<{ stop(closeActiveConnections?: boolean): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop(true)));
});

async function envelope(requestId: string): Promise<string> {
  const keys = generateKeyPairSync("x25519");
  const sealed = await sealRequest(Buffer.from("{}"), {
    exitPublicKey: keys.publicKey,
    keyId: "test-key",
    paddingBytes: 64,
    requestId,
  });
  return JSON.stringify(sealed.envelope);
}

function config(): RelayConfig {
  return {
    hostname: "127.0.0.1",
    port: 0,
    exitUrl: new URL("https://exit.example/v1/chat/completions"),
    exitToken: Redacted.make("exit-token"),
    tenantTokens: new Map([["tenant-one", Redacted.make("tenant-token")]]),
    requestTtlMs: 60_000,
    maxRequestEntries: 100,
    maxRequestEntriesPerTenant: 100,
    maxEnvelopeBytes: 4096,
    maxConcurrentRequests: 1,
    exitTimeoutMs: 1_000,
  };
}

function services(config: RelayConfig, exitFetch: RelayFetch) {
  return Layer.mergeAll(
    tenantAuthenticatorLayer(config.tenantTokens),
    requestTrackerLayer({
      ttlMs: config.requestTtlMs,
      maxEntries: config.maxRequestEntries,
      maxEntriesPerTenant: config.maxRequestEntriesPerTenant,
    }),
    concurrencyLimiterLayer(config.maxConcurrentRequests),
    exitClientLayer({
      url: config.exitUrl,
      token: config.exitToken,
      timeoutMs: config.exitTimeoutMs,
    }).pipe(
      Layer.provide(
        Layer.succeed(ExitTransport, {
          fetch: exitFetch,
        }),
      ),
    ),
    relayObserverNoop,
  );
}

function serverWith(exitFetch: RelayFetch) {
  const configured = config();
  return launchHttpServer(createRelayServer(configured, services(configured, exitFetch)));
}

function post(server: { port?: number }, body: string): Promise<Response> {
  if (server.port === undefined) throw new Error("test server has no port");
  return fetch(`http://127.0.0.1:${server.port}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: "Bearer tenant-token",
      "content-type": "application/json",
    },
    body,
  });
}

describe("Relay Effect runtime", () => {
  test("uses a replacement service Layer and releases concurrency", async () => {
    const server = await serverWith(async () => new Response("frame\n"));
    servers.push(server);

    const first = await post(server, await envelope("request-one"));
    expect(await first.text()).toBe("frame\n");
    const second = await post(server, await envelope("request-two"));

    expect(second.status).toBe(200);
    expect(await second.text()).toBe("frame\n");
  });

  test("releases concurrency after an upstream failure", async () => {
    let calls = 0;
    const server = await serverWith(async () => {
      calls += 1;
      if (calls === 1) throw new Error("exit unavailable");
      return new Response("frame\n");
    });
    servers.push(server);

    const first = await post(server, await envelope("request-one"));
    const second = await post(server, await envelope("request-two"));

    expect(first.status).toBe(502);
    expect(second.status).toBe(200);
    expect(await second.text()).toBe("frame\n");
  });

  test("enforces concurrency and releases it when the consumer stops", async () => {
    let calls = 0;
    let upstreamCancelled = false;
    const server = await serverWith(async () => {
      calls += 1;
      if (calls > 1) return new Response("frame\n");
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Buffer.from("first frame\n"));
          },
          cancel() {
            upstreamCancelled = true;
          },
        }),
      );
    });
    servers.push(server);

    const first = await post(server, await envelope("request-one"));
    const saturated = await post(server, await envelope("request-two"));
    expect(saturated.status).toBe(429);

    await first.body?.cancel("test cancellation");
    const next = await post(server, await envelope("request-three"));

    expect(upstreamCancelled).toBeTrue();
    expect(next.status).toBe(200);
    expect(await next.text()).toBe("frame\n");
  });

  test("releases concurrency when the upstream body cannot be read", async () => {
    let calls = 0;
    const server = await serverWith(async () => {
      calls += 1;
      if (calls > 1) return new Response("frame\n");
      const response = new Response("frame\n");
      response.body?.getReader();
      return response;
    });
    servers.push(server);

    const first = await post(server, await envelope("request-one"));
    expect(first.status).toBe(500);
    await first.body?.cancel();

    const second = await post(server, await envelope("request-two"));
    expect(second.status).toBe(200);
    expect(await second.text()).toBe("frame\n");
  });
});

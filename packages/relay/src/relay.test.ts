import { afterEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { sealRequest } from "@shallot/protocol";
import type { RelayConfig, RelayFetch } from "./config.ts";
import { createRelayServer } from "./relay.ts";
import { MemoryRequestTracker } from "./request-tracker.ts";
import { StaticTenantAuthenticator } from "./tenant-auth.ts";

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

function config(exitFetch: RelayFetch): RelayConfig {
  return {
    hostname: "127.0.0.1",
    port: 0,
    exitUrl: new URL("https://exit.example/v1/chat/completions"),
    exitToken: "exit-token",
    authenticator: new StaticTenantAuthenticator(
      new Map([["tenant-one", "tenant-token"]]),
    ),
    requestTracker: new MemoryRequestTracker(60_000),
    maxEnvelopeBytes: 4096,
    maxConcurrentRequests: 1,
    exitTimeoutMs: 1_000,
    fetch: exitFetch,
  };
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
  test("releases concurrency after a completed response", async () => {
    const server = createRelayServer(config(async () => new Response("frame\n")));
    servers.push(server);

    const first = await post(server, await envelope("request-one"));
    expect(await first.text()).toBe("frame\n");
    const second = await post(server, await envelope("request-two"));

    expect(second.status).toBe(200);
    expect(await second.text()).toBe("frame\n");
  });

  test("releases concurrency after an upstream failure", async () => {
    let calls = 0;
    const server = createRelayServer(
      config(async () => {
        calls += 1;
        if (calls === 1) throw new Error("exit unavailable");
        return new Response("frame\n");
      }),
    );
    servers.push(server);

    const first = await post(server, await envelope("request-one"));
    const second = await post(server, await envelope("request-two"));

    expect(first.status).toBe(502);
    expect(second.status).toBe(200);
    expect(await second.text()).toBe("frame\n");
  });

  test("releases concurrency and cancels Exit when the consumer stops", async () => {
    let calls = 0;
    let upstreamCancelled = false;
    const server = createRelayServer(
      config(async () => {
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
      }),
    );
    servers.push(server);

    const first = await post(server, await envelope("request-one"));
    await first.body?.cancel("test cancellation");
    const second = await post(server, await envelope("request-two"));

    expect(upstreamCancelled).toBeTrue();
    expect(second.status).toBe(200);
    expect(await second.text()).toBe("frame\n");
  });
});

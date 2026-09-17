import { afterEach, describe, expect, test } from "bun:test";
import { createMockProviderServer } from "../src/mock-provider.ts";

const servers: Array<{
  stop(closeActiveConnections?: boolean): void | Promise<void>;
}> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop(true)));
});

describe("Mock provider Effect runtime", () => {
  test("converts an observation defect without leaking it", async () => {
    const server = createMockProviderServer(
      {
        hostname: "127.0.0.1",
        port: 0,
        chunkDelayMs: 0,
      },
      {
        observe() {
          throw new Error("provider-key-canary");
        },
      },
    );
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "mock-text", messages: [] }),
    });
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain("Provider request failed");
    expect(body).not.toContain("provider-key-canary");
  });
});

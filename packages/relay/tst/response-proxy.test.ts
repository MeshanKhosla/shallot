import { describe, expect, test } from "bun:test";
import type { RequestPermit } from "../src/concurrency-limiter.ts";
import { proxyResponseBody } from "../src/response-proxy.ts";

function trackedPermit(): { permit: RequestPermit; releases: () => number } {
  let count = 0;
  return {
    permit: {
      release() {
        count += 1;
      },
    },
    releases: () => count,
  };
}

function responseBody(value: string): ReadableStream<Uint8Array> {
  const body = new Response(value).body;
  if (!body) throw new Error("test response has no body");
  return body;
}

describe("Relay response proxy", () => {
  test("releases its permit after a complete response", async () => {
    const { permit, releases } = trackedPermit();
    const body = proxyResponseBody(responseBody("frame\n"), permit);

    expect(await new Response(body).text()).toBe("frame\n");
    expect(releases()).toBe(1);
  });

  test("releases its permit when the upstream fails", async () => {
    const { permit, releases } = trackedPermit();
    const body = proxyResponseBody(
      new ReadableStream({
        pull(controller) {
          controller.error(new Error("upstream failed"));
        },
      }),
      permit,
    );

    await expect(new Response(body).text()).rejects.toThrow("upstream failed");
    expect(releases()).toBe(1);
  });

  test("releases its permit when the observer fails", async () => {
    const { permit, releases } = trackedPermit();
    const body = proxyResponseBody(responseBody("frame\n"), permit, () => {
      throw new Error("observer failed");
    });

    await expect(new Response(body).text()).rejects.toThrow("observer failed");
    expect(releases()).toBe(1);
  });

  test("cancels a pending read and releases its permit once", async () => {
    const { permit, releases } = trackedPermit();
    let cancellations = 0;
    const body = proxyResponseBody(
      new ReadableStream({
        pull() {
          return new Promise<never>(() => undefined);
        },
        cancel() {
          cancellations += 1;
        },
      }),
      permit,
    );
    const reader = body.getReader();
    const pendingRead = reader.read();

    await reader.cancel("consumer stopped");
    expect((await pendingRead).done).toBeTrue();
    expect(cancellations).toBe(1);
    expect(releases()).toBe(1);

    await reader.cancel("already stopped");
    expect(releases()).toBe(1);
  });
});

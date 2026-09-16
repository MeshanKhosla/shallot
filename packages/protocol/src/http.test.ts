import { describe, expect, test } from "bun:test";
import { BodyTooLargeError, readLimitedBody } from "./http.ts";

describe("bounded request bodies", () => {
  test("reads a chunked body within the limit", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from("abc"));
          controller.enqueue(Buffer.from("def"));
          controller.close();
        },
      }),
    });

    expect((await readLimitedBody(request, 6)).toString()).toBe("abcdef");
  });

  test("cancels a chunked body as soon as it crosses the limit", async () => {
    let cancelled = false;
    const request = new Request("http://localhost", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from("abcd"));
          controller.enqueue(Buffer.from("efgh"));
        },
        cancel() {
          cancelled = true;
        },
      }),
    });

    await expect(readLimitedBody(request, 7)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(cancelled).toBeTrue();
  });

  test("rejects an oversized declared length without reading the body", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "content-length": "10" },
      body: "small",
    });

    await expect(readLimitedBody(request, 9)).rejects.toBeInstanceOf(BodyTooLargeError);
  });
});

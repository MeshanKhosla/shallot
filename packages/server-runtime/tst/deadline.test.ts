import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { keepDeadlineUntilStreamEnds, makeDeadline } from "../src/deadline.ts";

describe("Effect deadline", () => {
  test("remains active until the response stream ends", async () => {
    const deadline = await Effect.runPromise(makeDeadline(1));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        deadline.signal.addEventListener(
          "abort",
          () => controller.error(new Error("timed out")),
          { once: true },
        );
      },
    });

    await expect(
      new Response(keepDeadlineUntilStreamEnds(body, deadline)).text(),
    ).rejects.toThrow("timed out");
    expect(deadline.expired).toBeTrue();
  });

  test("cancels the deadline after the response stream ends", async () => {
    const deadline = await Effect.runPromise(makeDeadline(10));
    const body = new Response("complete").body;
    if (!body) throw new Error("expected a response body");

    expect(await new Response(keepDeadlineUntilStreamEnds(body, deadline)).text()).toBe(
      "complete",
    );
    await Effect.runPromise(Effect.sleep(20));
    expect(deadline.expired).toBeFalse();
  });
});

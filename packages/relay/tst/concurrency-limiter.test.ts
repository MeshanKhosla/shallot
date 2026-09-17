import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  ConcurrencyLimiter,
  concurrencyLimiterLayer,
} from "../src/concurrency-limiter.ts";

describe("Relay concurrency limiter", () => {
  test("releases a permit exactly once", async () => {
    const program = Effect.gen(function* () {
      const limiter = yield* ConcurrencyLimiter;
      const permit = yield* limiter.acquire();
      expect(yield* limiter.activeCount).toBe(1);
      expect((yield* Effect.flip(limiter.acquire()))._tag).toBe(
        "RelayConcurrencyExhausted",
      );

      permit.release();
      permit.release();
      expect(yield* limiter.activeCount).toBe(0);
    }).pipe(Effect.provide(concurrencyLimiterLayer(1)));

    await Effect.runPromise(program);
  });
});

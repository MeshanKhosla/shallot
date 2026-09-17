import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { MemoryRequestTracker } from "../src/request-tracker.ts";
import { StaticTenantAuthenticator } from "../src/tenant-auth.ts";

describe("Relay security controls", () => {
  test("authenticates a configured tenant token", () => {
    const authenticator = new StaticTenantAuthenticator(
      new Map([
        ["tenant-one", "token-one"],
        ["tenant-two", "token-two"],
      ]),
    );

    expect(Effect.runSync(authenticator.authenticate("Bearer token-two"))).toEqual({
      id: "tenant-two",
    });
    expect(() =>
      Effect.runSync(authenticator.authenticate("Bearer wrong-token")),
    ).toThrow("Tenant authentication failed");
    expect(() => Effect.runSync(authenticator.authenticate(null))).toThrow(
      "Tenant authentication failed",
    );
  });

  test("tracks request IDs separately for each tenant", async () => {
    const tracker = new MemoryRequestTracker(100);
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(1_000);
        expect(yield* tracker.claim("tenant-one", "request-one")).toBeTrue();
        expect(yield* tracker.claim("tenant-one", "request-one")).toBeFalse();
        expect(yield* tracker.claim("tenant-two", "request-one")).toBeTrue();
        yield* TestClock.adjust(101);
        expect(yield* tracker.claim("tenant-one", "request-one")).toBeTrue();
      }).pipe(Effect.provide(TestClock.layer())),
    );
  });

  test("bounds tracked request IDs", () => {
    const tracker = new MemoryRequestTracker(100, 1);
    expect(Effect.runSync(tracker.claim("tenant-one", "request-one"))).toBeTrue();
    expect(() => Effect.runSync(tracker.claim("tenant-one", "request-two"))).toThrow(
      "request tracker is full",
    );
  });

  test("isolates request capacity between tenants", () => {
    const tracker = new MemoryRequestTracker(100, 10, 1);
    expect(Effect.runSync(tracker.claim("tenant-one", "request-one"))).toBeTrue();
    expect(() => Effect.runSync(tracker.claim("tenant-one", "request-two"))).toThrow(
      "request tracker is full",
    );
    expect(Effect.runSync(tracker.claim("tenant-two", "request-one"))).toBeTrue();
  });
});

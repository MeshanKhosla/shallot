import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { MemoryReplayCache } from "../src/replay-cache.ts";
import { ReplayProtection, replayProtectionLayer } from "../src/replay-protection.ts";
import { sanitizeChatRequest } from "../src/sanitize-request.ts";
import { requireRelayAuthorization } from "../src/service-auth.ts";

describe("Exit security controls", () => {
  test("authenticates only the Relay service token", () => {
    expect(() =>
      requireRelayAuthorization("Bearer relay-token", "relay-token"),
    ).not.toThrow();
    expect(() => requireRelayAuthorization("Bearer tenant-token", "relay-token")).toThrow(
      "Relay authentication failed",
    );
  });

  test("removes identity and unknown fields from provider requests", () => {
    const sanitized = sanitizeChatRequest(
      {
        model: "allowed-model",
        messages: [
          {
            role: "user",
            content: "hello",
            name: "tenant-user-id",
            tenant_marker: "drop-me",
          },
        ],
        user: "tenant-user-id",
        metadata: { tenant: "tenant-one" },
        arbitrary: "drop-me",
        temperature: 0,
        tools: [
          {
            type: "function",
            tenant_marker: "drop-me",
            function: {
              name: "weather",
              description: "Get weather",
              parameters: { type: "object" },
              tenant_marker: "drop-me",
            },
          },
        ],
      },
      new Set(["allowed-model"]),
    );

    expect(sanitized).toEqual({
      model: "allowed-model",
      messages: [{ role: "user", content: "hello" }],
      temperature: 0,
      tools: [
        {
          type: "function",
          function: {
            name: "weather",
            description: "Get weather",
            parameters: { type: "object" },
          },
        },
      ],
    });
  });

  test("rejects models outside the configured allowlist", () => {
    expect(() =>
      sanitizeChatRequest(
        { model: "blocked-model", messages: [] },
        new Set(["allowed-model"]),
      ),
    ).toThrow("model is not allowed");
  });

  test("expires replay entries", () => {
    const cache = new MemoryReplayCache(100);

    expect(cache.claim("envelope-one", 1_000)).toBeTrue();
    expect(cache.claim("envelope-one", 1_000)).toBeFalse();
    expect(cache.claim("envelope-one", 1_101)).toBeTrue();
  });

  test("bounds replay entries", () => {
    const cache = new MemoryReplayCache(100, 1);
    expect(cache.claim("envelope-one", 1_000)).toBeTrue();
    expect(() => cache.claim("envelope-two", 1_000)).toThrow("replay cache is full");
  });

  test("uses the Effect clock for replay expiry", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const protection = yield* ReplayProtection;
        yield* TestClock.setTime(1_000);
        expect(yield* protection.claim("envelope-one")).toBeTrue();
        expect(yield* protection.claim("envelope-one")).toBeFalse();
        yield* TestClock.adjust(101);
        expect(yield* protection.claim("envelope-one")).toBeTrue();
      }).pipe(
        Effect.provide([
          replayProtectionLayer({ ttlMs: 100, maxEntries: 10 }),
          TestClock.layer(),
        ]),
      ),
    );
  });
});

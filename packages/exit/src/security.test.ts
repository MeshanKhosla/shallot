import { describe, expect, test } from "bun:test";
import { MemoryReplayCache } from "./replay-cache.ts";
import { sanitizeChatRequest } from "./sanitize-request.ts";
import { requireRelayAuthorization } from "./service-auth.ts";

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
        messages: [{ role: "user", content: "hello" }],
        user: "tenant-user-id",
        metadata: { tenant: "tenant-one" },
        arbitrary: "drop-me",
        temperature: 0,
      },
      new Set(["allowed-model"]),
    );

    expect(sanitized).toEqual({
      model: "allowed-model",
      messages: [{ role: "user", content: "hello" }],
      temperature: 0,
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
    let now = 1_000;
    const cache = new MemoryReplayCache(100, () => now);

    expect(cache.claim("envelope-one")).toBeTrue();
    expect(cache.claim("envelope-one")).toBeFalse();
    now += 101;
    expect(cache.claim("envelope-one")).toBeTrue();
  });

  test("bounds replay entries", () => {
    const cache = new MemoryReplayCache(100, () => 1_000, 1);
    expect(cache.claim("envelope-one")).toBeTrue();
    expect(() => cache.claim("envelope-two")).toThrow("replay cache is full");
  });
});

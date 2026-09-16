import { describe, expect, test } from "bun:test";
import { MemoryRequestTracker } from "./request-tracker.ts";
import { StaticTenantAuthenticator } from "./tenant-auth.ts";

describe("Relay security controls", () => {
  test("authenticates a configured tenant token", () => {
    const authenticator = new StaticTenantAuthenticator(
      new Map([
        ["tenant-one", "token-one"],
        ["tenant-two", "token-two"],
      ]),
    );

    expect(authenticator.authenticate("Bearer token-two")).toEqual({
      id: "tenant-two",
    });
    expect(() => authenticator.authenticate("Bearer wrong-token")).toThrow(
      "Tenant authentication failed",
    );
    expect(() => authenticator.authenticate(null)).toThrow(
      "Tenant authentication failed",
    );
  });

  test("tracks request IDs separately for each tenant", () => {
    let now = 1_000;
    const tracker = new MemoryRequestTracker(100, () => now);

    expect(tracker.claim("tenant-one", "request-one")).toBeTrue();
    expect(tracker.claim("tenant-one", "request-one")).toBeFalse();
    expect(tracker.claim("tenant-two", "request-one")).toBeTrue();
    now += 101;
    expect(tracker.claim("tenant-one", "request-one")).toBeTrue();
  });
});

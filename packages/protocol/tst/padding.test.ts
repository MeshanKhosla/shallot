import { describe, expect, test } from "bun:test";
import { padPayload, unpadPayload } from "../src/padding.ts";

describe("payload padding", () => {
  for (const size of [0, 1, 251, 252, 253, 256, 511, 512]) {
    test(`round-trips ${size} bytes`, () => {
      const payload = Buffer.alloc(size, 0x5a);
      const padded = padPayload(payload, 256);

      expect(padded.byteLength % 256).toBe(0);
      expect(padded.byteLength).toBeGreaterThanOrEqual(payload.byteLength + 4);
      expect(unpadPayload(padded)).toEqual(payload);
    });
  }

  test("rejects a forged length prefix", () => {
    const padded = Buffer.alloc(16);
    padded.writeUInt32BE(100, 0);
    expect(() => unpadPayload(padded)).toThrow("invalid padded payload length");
  });

  test("rejects an unusable block size", () => {
    expect(() => padPayload(Buffer.from("test"), 3)).toThrow(
      "padding block size must be an integer of at least 4 bytes",
    );
  });
});

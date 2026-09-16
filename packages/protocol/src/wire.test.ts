import { describe, expect, test } from "bun:test";
import {
  parseSealedFrame,
  parseSealedRequest,
  SEALED_FRAME_VERSION,
  SEALED_REQUEST_VERSION,
} from "./wire.ts";

const x25519Key = Buffer.alloc(32, 1).toString("base64url");

const request = {
  version: SEALED_REQUEST_VERSION,
  requestId: "request-1",
  keyId: "key-1",
  encapsulatedKey: x25519Key,
  responsePublicKey: x25519Key,
  ciphertext: "ghi",
};

describe("wire validation", () => {
  test("accepts a complete sealed request", () => {
    expect(parseSealedRequest(request)).toEqual(request);
  });

  for (const field of ["requestId", "keyId", "encapsulatedKey", "ciphertext"] as const) {
    test(`rejects a request without ${field}`, () => {
      expect(() => parseSealedRequest({ ...request, [field]: undefined })).toThrow();
    });
  }

  test("rejects malformed and incorrectly sized key encodings", () => {
    expect(() =>
      parseSealedRequest({ ...request, encapsulatedKey: "not+base64url" }),
    ).toThrow("invalid sealed request");
    expect(() =>
      parseSealedRequest({ ...request, responsePublicKey: "c2hvcnQ" }),
    ).toThrow("invalid sealed request");
  });

  test("rejects oversized request identifiers", () => {
    expect(() => parseSealedRequest({ ...request, requestId: "r".repeat(129) })).toThrow(
      "invalid sealed request",
    );
  });

  test("requires the head at sequence zero", () => {
    expect(() =>
      parseSealedFrame({
        version: SEALED_FRAME_VERSION,
        requestId: "request-1",
        sequence: 0,
        kind: "data",
        final: false,
        encapsulatedKey: x25519Key,
        ciphertext: "def",
      }),
    ).toThrow("first response frame must be a head frame");
  });

  test("rejects an encapsulated key after sequence zero", () => {
    expect(() =>
      parseSealedFrame({
        version: SEALED_FRAME_VERSION,
        requestId: "request-1",
        sequence: 1,
        kind: "data",
        final: true,
        encapsulatedKey: x25519Key,
        ciphertext: "def",
      }),
    ).toThrow("only the first response frame may contain an encapsulated key");
  });
});

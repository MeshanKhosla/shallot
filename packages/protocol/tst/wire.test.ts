import { describe, expect, test } from "bun:test";
import {
  parseSealedFrame,
  parseSealedRequest,
  SEALED_FRAME_VERSION,
  SEALED_REQUEST_VERSION,
} from "../src/wire.ts";

const x25519Key = Buffer.alloc(32, 1).toString("base64url");
const ciphertext = Buffer.from([1, 2]).toString("base64url");

const request = {
  version: SEALED_REQUEST_VERSION,
  requestId: "request-1",
  keyId: "key-1",
  encapsulatedKey: x25519Key,
  responsePublicKey: x25519Key,
  ciphertext,
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

  test("rejects delimiters in request identifiers", () => {
    expect(() => parseSealedRequest({ ...request, keyId: "current\nprevious" })).toThrow(
      "invalid sealed request",
    );
  });

  test("rejects non-canonical base64url", () => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const canonical = Buffer.alloc(32, 1).toString("base64url");
    const lastIndex = alphabet.indexOf(canonical.at(-1) ?? "");
    const alternate = canonical.slice(0, -1) + alphabet[lastIndex + 1];

    expect(Buffer.from(alternate, "base64url")).toEqual(
      Buffer.from(canonical, "base64url"),
    );
    expect(() => parseSealedRequest({ ...request, encapsulatedKey: alternate })).toThrow(
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
        ciphertext,
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
        ciphertext,
      }),
    ).toThrow("only the first response frame may contain an encapsulated key");
  });
});

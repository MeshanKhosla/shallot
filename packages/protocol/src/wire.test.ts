import { describe, expect, test } from "bun:test";
import {
  parseSealedFrame,
  parseSealedRequest,
  SEALED_FRAME_VERSION,
  SEALED_REQUEST_VERSION,
} from "./wire.ts";

const request = {
  version: SEALED_REQUEST_VERSION,
  requestId: "request-1",
  keyId: "key-1",
  encapsulatedKey: "abc",
  responsePublicKey: "def",
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

  test("requires the head at sequence zero", () => {
    expect(() =>
      parseSealedFrame({
        version: SEALED_FRAME_VERSION,
        requestId: "request-1",
        sequence: 0,
        kind: "data",
        final: false,
        encapsulatedKey: "abc",
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
        encapsulatedKey: "abc",
        ciphertext: "def",
      }),
    ).toThrow("only the first response frame may contain an encapsulated key");
  });
});

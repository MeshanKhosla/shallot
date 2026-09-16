import { isBase64Url, isBase64UrlBytes, isRecord } from "./encoding.ts";

export const SEALED_REQUEST_VERSION = "shallot.hpke-request.v1" as const;
export const SEALED_FRAME_VERSION = "shallot.hpke-frame.v1" as const;

const RESPONSE_INFO_PREFIX = "shallot/response/v1\n";
const X25519_KEY_BYTES = 32;
const MAX_ID_LENGTH = 128;
const ID_PATTERN = /^[A-Za-z0-9._~-]+$/;

export type ResponseFrameKind = "head" | "data";

export interface SealedRequest {
  version: typeof SEALED_REQUEST_VERSION;
  requestId: string;
  keyId: string;
  encapsulatedKey: string;
  responsePublicKey: string;
  ciphertext: string;
}

export interface SealedFrame {
  version: typeof SEALED_FRAME_VERSION;
  requestId: string;
  sequence: number;
  kind: ResponseFrameKind;
  final: boolean;
  encapsulatedKey?: string;
  ciphertext: string;
}

function isWireIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    ID_PATTERN.test(value)
  );
}

export function parseSealedRequest(value: unknown): SealedRequest {
  if (!isRecord(value)) throw new Error("invalid sealed request");
  if (
    value.version !== SEALED_REQUEST_VERSION ||
    !isWireIdentifier(value.requestId) ||
    !isWireIdentifier(value.keyId) ||
    !isBase64UrlBytes(value.encapsulatedKey, X25519_KEY_BYTES) ||
    !isBase64UrlBytes(value.responsePublicKey, X25519_KEY_BYTES) ||
    !isBase64Url(value.ciphertext)
  ) {
    throw new Error("invalid sealed request");
  }
  return value as unknown as SealedRequest;
}

export function parseSealedFrame(value: unknown): SealedFrame {
  if (!isRecord(value)) throw new Error("invalid sealed response frame");
  if (
    value.version !== SEALED_FRAME_VERSION ||
    !isWireIdentifier(value.requestId) ||
    typeof value.sequence !== "number" ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 0 ||
    (value.kind !== "head" && value.kind !== "data") ||
    typeof value.final !== "boolean" ||
    (value.encapsulatedKey !== undefined &&
      !isBase64UrlBytes(value.encapsulatedKey, X25519_KEY_BYTES)) ||
    !isBase64Url(value.ciphertext)
  ) {
    throw new Error("invalid sealed response frame");
  }
  if (value.sequence === 0 && typeof value.encapsulatedKey !== "string") {
    throw new Error("first response frame is missing its encapsulated key");
  }
  if (value.sequence !== 0 && value.encapsulatedKey !== undefined) {
    throw new Error("only the first response frame may contain an encapsulated key");
  }
  if (value.sequence === 0 && value.kind !== "head") {
    throw new Error("first response frame must be a head frame");
  }
  if (value.sequence !== 0 && value.kind !== "data") {
    throw new Error("only the first response frame may be a head frame");
  }
  return value as unknown as SealedFrame;
}

export function requestAad(
  requestId: string,
  keyId: string,
  responsePublicKey: string,
): Buffer {
  return Buffer.from(
    JSON.stringify([SEALED_REQUEST_VERSION, requestId, keyId, responsePublicKey]),
  );
}

export function responseInfo(requestId: string): Buffer {
  return Buffer.from(`${RESPONSE_INFO_PREFIX}${requestId}`);
}

export function frameAad(
  requestId: string,
  sequence: number,
  kind: ResponseFrameKind,
  final: boolean,
): Buffer {
  return Buffer.from(
    `${SEALED_FRAME_VERSION}\n${requestId}\n${sequence}\n${kind}\n${final ? 1 : 0}`,
  );
}

export function encodeBase64Url(value: ArrayBufferLike | ArrayBufferView): string {
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString(
      "base64url",
    );
  }
  return Buffer.from(value).toString("base64url");
}

export function decodeBase64Url(value: string, field: string): Buffer {
  if (!isBase64Url(value)) {
    throw new Error(`invalid ${field}`);
  }
  return Buffer.from(value, "base64url");
}

export function isBase64Url(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 === 1 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    return false;
  }
  return Buffer.from(value, "base64url").toString("base64url") === value;
}

export function isBase64UrlBytes(value: unknown, byteLength: number): value is string {
  if (!isBase64Url(value)) return false;
  const encodedLength = Math.ceil((byteLength * 4) / 3);
  return (
    value.length === encodedLength &&
    Buffer.from(value, "base64url").byteLength === byteLength
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

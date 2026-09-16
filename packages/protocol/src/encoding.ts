export function encodeBase64Url(
  value: ArrayBufferLike | ArrayBufferView,
): string {
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString(
      "base64url",
    );
  }
  return Buffer.from(value).toString("base64url");
}

export function decodeBase64Url(value: string, field: string): Buffer {
  if (
    value.length === 0 ||
    value.length % 4 === 1 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new Error(`invalid ${field}`);
  }
  return Buffer.from(value, "base64url");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

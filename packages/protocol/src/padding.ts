import { randomBytes } from "node:crypto";

const LENGTH_PREFIX_BYTES = 4;

export function padPayload(payload: Uint8Array, blockSize: number): Buffer {
  if (!Number.isSafeInteger(blockSize) || blockSize < LENGTH_PREFIX_BYTES) {
    throw new Error("padding block size must be an integer of at least 4 bytes");
  }
  if (payload.byteLength > 0xffffffff) {
    throw new Error("payload is too large");
  }

  const required = LENGTH_PREFIX_BYTES + payload.byteLength;
  const paddedLength = Math.ceil(required / blockSize) * blockSize;
  const padded = randomBytes(paddedLength);
  padded.writeUInt32BE(payload.byteLength, 0);
  Buffer.from(payload).copy(padded, LENGTH_PREFIX_BYTES);
  return padded;
}

export function unpadPayload(padded: Uint8Array): Buffer {
  if (padded.byteLength < LENGTH_PREFIX_BYTES) {
    throw new Error("padded payload is too short");
  }

  const buffer = Buffer.from(padded);
  const payloadLength = buffer.readUInt32BE(0);
  if (payloadLength > buffer.byteLength - LENGTH_PREFIX_BYTES) {
    throw new Error("invalid padded payload length");
  }

  return buffer.subarray(LENGTH_PREFIX_BYTES, LENGTH_PREFIX_BYTES + payloadLength);
}

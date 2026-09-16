export const SEALED_STREAM_CONTENT_TYPE = "application/x-ndjson" as const;

export const PATHS = {
  chat: "/v1/chat/completions",
} as const;

export class BodyTooLargeError extends Error {
  constructor() {
    super("request body exceeds the configured limit");
    this.name = "BodyTooLargeError";
  }
}

function declaredBodyLength(req: Request): number | undefined {
  const value = req.headers.get("content-length");
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export async function readLimitedBody(req: Request, maxBytes: number): Promise<Buffer> {
  const declaredLength = declaredBodyLength(req);
  if (declaredLength !== undefined && declaredLength > maxBytes) {
    throw new BodyTooLargeError();
  }
  if (!req.body) return Buffer.alloc(0);

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, totalBytes);
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("request body exceeded the configured limit");
        throw new BodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

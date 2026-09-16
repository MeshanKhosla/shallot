export interface ResponseHead {
  status: number;
  contentType: "application/json" | "text/event-stream; charset=utf-8";
}

export function encodeResponseHead(head: ResponseHead): Buffer {
  validateResponseHead(head);
  return Buffer.from(JSON.stringify(head));
}

export function decodeResponseHead(payload: Uint8Array): ResponseHead {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    throw new Error("invalid encrypted response head");
  }

  validateResponseHead(value);
  return value;
}

function validateResponseHead(value: unknown): asserts value is ResponseHead {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid encrypted response head");
  }

  const head = value as Partial<ResponseHead>;
  if (
    typeof head.status !== "number" ||
    !Number.isSafeInteger(head.status) ||
    head.status < 100 ||
    head.status > 599 ||
    (head.contentType !== "application/json" &&
      head.contentType !== "text/event-stream; charset=utf-8")
  ) {
    throw new Error("invalid encrypted response head");
  }
}

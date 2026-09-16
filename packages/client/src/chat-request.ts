import { SidecarHttpError } from "./errors.ts";

export interface ChatRequest {
  stream?: boolean;
  [key: string]: unknown;
}

export interface ParsedChatRequest {
  body: Uint8Array;
  value: ChatRequest;
}

function parseContentLength(req: Request): number | undefined {
  const header = req.headers.get("content-length");
  if (header === null) return undefined;

  const value = Number(header);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function parseJsonObject(body: Uint8Array): ChatRequest {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new SidecarHttpError(
      400,
      "request body must be valid JSON",
      "invalid_request_error",
    );
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SidecarHttpError(
      400,
      "request body must be a JSON object",
      "invalid_request_error",
    );
  }

  const request = value as ChatRequest;
  if (request.stream !== undefined && typeof request.stream !== "boolean") {
    throw new SidecarHttpError(
      400,
      "stream must be a boolean",
      "invalid_request_error",
    );
  }
  return request;
}

export async function readChatRequest(
  req: Request,
  maxRequestBytes: number,
): Promise<ParsedChatRequest> {
  const contentLength = parseContentLength(req);
  if (contentLength !== undefined && contentLength > maxRequestBytes) {
    throw new SidecarHttpError(
      413,
      "request body is too large",
      "request_too_large",
    );
  }

  const body = new Uint8Array(await req.arrayBuffer());
  if (body.byteLength > maxRequestBytes) {
    throw new SidecarHttpError(
      413,
      "request body is too large",
      "request_too_large",
    );
  }

  return { body, value: parseJsonObject(body) };
}

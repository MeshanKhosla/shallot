import { BodyTooLargeError, readLimitedBody } from "@shallot/protocol";
import { SidecarHttpError } from "./errors.ts";

export interface ChatRequest {
  stream?: boolean;
  [key: string]: unknown;
}

export interface ParsedChatRequest {
  body: Uint8Array;
  value: ChatRequest;
}

export async function readChatRequest(
  req: Request,
  maxRequestBytes: number,
): Promise<ParsedChatRequest> {
  const mediaType = req.headers.get("content-type")?.split(";", 1).at(0)?.trim();
  if (mediaType !== "application/json") {
    throw new SidecarHttpError(
      415,
      "content-type must be application/json",
      "invalid_request_error",
    );
  }

  let body: Uint8Array;
  try {
    body = await readLimitedBody(req, maxRequestBytes);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      throw new SidecarHttpError(413, "request body is too large", "request_too_large");
    }
    throw error;
  }

  return { body, value: parseJsonObject(body) };
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
    throw new SidecarHttpError(400, "stream must be a boolean", "invalid_request_error");
  }
  return request;
}

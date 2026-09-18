import { BodyTooLargeError, readLimitedBody } from "@shallot/protocol";
import {
  SidecarInvalidRequest,
  SidecarRequestTooLarge,
  SidecarUnsupportedContentType,
} from "./errors.ts";

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
    throw new SidecarUnsupportedContentType();
  }

  let body: Uint8Array;
  try {
    body = await readLimitedBody(req, maxRequestBytes);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      throw new SidecarRequestTooLarge();
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
    throw new SidecarInvalidRequest({
      message: "request body must be valid JSON",
    });
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SidecarInvalidRequest({
      message: "request body must be a JSON object",
    });
  }

  const request = value as ChatRequest;
  if (request.stream !== undefined && typeof request.stream !== "boolean") {
    throw new SidecarInvalidRequest({ message: "stream must be a boolean" });
  }
  return request;
}

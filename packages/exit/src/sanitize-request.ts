import { ExitHttpError } from "./errors.ts";

const ALLOWED_FIELDS = [
  "model",
  "messages",
  "temperature",
  "top_p",
  "n",
  "stream",
  "stop",
  "max_tokens",
  "max_completion_tokens",
  "presence_penalty",
  "frequency_penalty",
  "logit_bias",
  "tools",
  "tool_choice",
  "response_format",
  "seed",
  "stream_options",
  "parallel_tool_calls",
  "reasoning_effort",
] as const;

export interface SanitizedChatRequest extends Record<string, unknown> {
  model: string;
  messages: unknown[];
  stream?: boolean;
}

export function sanitizeChatRequest(
  value: unknown,
  allowedModels?: ReadonlySet<string>,
): SanitizedChatRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ExitHttpError(
      400,
      "Request must be a JSON object",
      "invalid_request_error",
    );
  }

  const source = value as Record<string, unknown>;
  if (typeof source.model !== "string" || source.model.length === 0) {
    throw new ExitHttpError(400, "model is required", "invalid_request_error");
  }
  if (!Array.isArray(source.messages)) {
    throw new ExitHttpError(400, "messages must be an array", "invalid_request_error");
  }
  if (source.stream !== undefined && typeof source.stream !== "boolean") {
    throw new ExitHttpError(400, "stream must be a boolean", "invalid_request_error");
  }
  if (allowedModels && !allowedModels.has(source.model)) {
    throw new ExitHttpError(400, "model is not allowed", "invalid_request_error");
  }

  const sanitized: Record<string, unknown> = {};
  for (const field of ALLOWED_FIELDS) {
    if (source[field] !== undefined) sanitized[field] = source[field];
  }
  return sanitized as SanitizedChatRequest;
}

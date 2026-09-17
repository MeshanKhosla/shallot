import { ExitInvalidRequest } from "./errors.ts";

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

const MESSAGE_FIELDS = [
  "role",
  "content",
  "refusal",
  "tool_calls",
  "tool_call_id",
  "function_call",
  "audio",
] as const;
const TOOL_FIELDS = ["type", "function"] as const;
const FUNCTION_FIELDS = ["name", "description", "parameters", "strict"] as const;
const TOOL_CALL_FIELDS = ["id", "type", "function"] as const;
const FUNCTION_CALL_FIELDS = ["name", "arguments"] as const;
const RESPONSE_FORMAT_FIELDS = ["type", "json_schema"] as const;
const JSON_SCHEMA_FIELDS = ["name", "description", "schema", "strict"] as const;
const STREAM_OPTION_FIELDS = ["include_usage", "include_obfuscation"] as const;

export interface SanitizedChatRequest extends Record<string, unknown> {
  model: string;
  messages: unknown[];
  stream?: boolean;
}

function copyFields(
  value: unknown,
  fields: readonly string[],
  description: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ExitInvalidRequest({ message: `${description} must be an object` });
  }
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (source[field] !== undefined) result[field] = source[field];
  }
  return result;
}

function sanitizeMessages(messages: unknown[]): Array<Record<string, unknown>> {
  return messages.map((message) => {
    const sanitized = copyFields(message, MESSAGE_FIELDS, "each message");
    if (typeof sanitized.role !== "string") {
      throw new ExitInvalidRequest({ message: "each message needs a role" });
    }
    if (sanitized.tool_calls !== undefined) {
      if (!Array.isArray(sanitized.tool_calls)) {
        throw new ExitInvalidRequest({ message: "tool_calls must be an array" });
      }
      sanitized.tool_calls = sanitized.tool_calls.map((toolCall) => {
        const call = copyFields(toolCall, TOOL_CALL_FIELDS, "each tool call");
        if (call.function !== undefined) {
          call.function = copyFields(
            call.function,
            FUNCTION_CALL_FIELDS,
            "tool call function",
          );
        }
        return call;
      });
    }
    if (sanitized.function_call !== undefined) {
      sanitized.function_call = copyFields(
        sanitized.function_call,
        FUNCTION_CALL_FIELDS,
        "function_call",
      );
    }
    return sanitized;
  });
}

function sanitizeTools(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    throw new ExitInvalidRequest({ message: "tools must be an array" });
  }
  return value.map((tool) => {
    const sanitized = copyFields(tool, TOOL_FIELDS, "each tool");
    if (sanitized.function !== undefined) {
      sanitized.function = copyFields(
        sanitized.function,
        FUNCTION_FIELDS,
        "tool function",
      );
    }
    return sanitized;
  });
}

export function sanitizeChatRequest(
  value: unknown,
  allowedModels?: ReadonlySet<string>,
): SanitizedChatRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ExitInvalidRequest({ message: "Request must be a JSON object" });
  }

  const source = value as Record<string, unknown>;
  if (typeof source.model !== "string" || source.model.length === 0) {
    throw new ExitInvalidRequest({ message: "model is required" });
  }
  if (!Array.isArray(source.messages)) {
    throw new ExitInvalidRequest({ message: "messages must be an array" });
  }
  if (source.stream !== undefined && typeof source.stream !== "boolean") {
    throw new ExitInvalidRequest({ message: "stream must be a boolean" });
  }
  if (allowedModels && !allowedModels.has(source.model)) {
    throw new ExitInvalidRequest({ message: "model is not allowed" });
  }

  const sanitized: Record<string, unknown> = {};
  for (const field of ALLOWED_FIELDS) {
    const fieldValue = source[field];
    if (fieldValue === undefined) continue;
    if (field === "messages") {
      sanitized.messages = sanitizeMessages(source.messages);
    } else if (field === "tools") {
      sanitized.tools = sanitizeTools(fieldValue);
    } else if (field === "response_format") {
      const responseFormat = copyFields(
        fieldValue,
        RESPONSE_FORMAT_FIELDS,
        "response_format",
      );
      if (responseFormat.json_schema !== undefined) {
        responseFormat.json_schema = copyFields(
          responseFormat.json_schema,
          JSON_SCHEMA_FIELDS,
          "response_format.json_schema",
        );
      }
      sanitized.response_format = responseFormat;
    } else if (field === "stream_options") {
      sanitized.stream_options = copyFields(
        fieldValue,
        STREAM_OPTION_FIELDS,
        "stream_options",
      );
    } else {
      sanitized[field] = fieldValue;
    }
  }
  return sanitized as SanitizedChatRequest;
}

interface ChatRequest extends Record<string, unknown> {
  model: string;
  messages: Array<Record<string, unknown>>;
  stream?: boolean;
}

const CREATED = 1_700_000_000;

function usage() {
  return {
    prompt_tokens: 7,
    completion_tokens: 3,
    total_tokens: 10,
  };
}

function completion(
  request: ChatRequest,
  message: Record<string, unknown>,
  finishReason = "stop",
): Response {
  return Response.json({
    id: "chatcmpl_shallot_mock",
    object: "chat.completion",
    created: CREATED,
    model: request.model,
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: usage(),
  });
}

function finalTextFor(request: ChatRequest): string {
  const hasToolResult = request.messages.some((message) => message.role === "tool");
  if (hasToolResult) return "The tool returned sunny.";
  if (request.model === "mock-json") return '{"answer":"structured-response"}';
  return "deterministic-response";
}

function sseChunk(request: ChatRequest, content: string, finishReason: string | null) {
  return `data: ${JSON.stringify({
    id: "chatcmpl_shallot_mock",
    object: "chat.completion.chunk",
    created: CREATED,
    model: request.model,
    choices: [
      {
        index: 0,
        delta: content ? { content } : {},
        finish_reason: finishReason,
      },
    ],
    ...(finishReason ? { usage: usage() } : {}),
  })}\n\n`;
}

function streamingCompletion(
  request: ChatRequest,
  delayMs: number,
  observeCancellation?: () => void,
): Response {
  const text = finalTextFor(request);
  const midpoint = Math.ceil(text.length / 2);
  const encoded = new TextEncoder().encode(
    sseChunk(request, text.slice(0, midpoint), null) +
      sseChunk(request, text.slice(midpoint), null) +
      sseChunk(request, "", "stop") +
      "data: [DONE]\n\n",
  );
  const splitPoints = [1, 7, 19, 43, encoded.byteLength];
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (const point of splitPoints) {
    const end = Math.min(point, encoded.byteLength);
    if (end > offset) chunks.push(encoded.subarray(offset, end));
    offset = end;
  }
  let index = 0;
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index > 0 && delayMs > 0) await Bun.sleep(delayMs);
      if (cancelled) return;
      const chunk = chunks[index];
      if (!chunk) {
        controller.close();
        return;
      }
      index += 1;
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
      observeCancellation?.();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
}

export function createOpenAIResponse(
  request: ChatRequest,
  chunkDelayMs: number,
  observeCancellation?: () => void,
): Response {
  if (request.model === "mock-error") {
    return Response.json(
      { error: { message: "configured provider error", type: "mock_error" } },
      { status: 429 },
    );
  }

  if (
    request.model === "mock-tool" &&
    !request.messages.some((message) => message.role === "tool")
  ) {
    return completion(
      request,
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_weather",
            type: "function",
            function: {
              name: "weather",
              arguments: '{"city":"Paris"}',
            },
          },
        ],
      },
      "tool_calls",
    );
  }

  if (request.stream === true) {
    return streamingCompletion(request, chunkDelayMs, observeCancellation);
  }
  return completion(request, {
    role: "assistant",
    content: finalTextFor(request),
  });
}

export function parseChatRequest(value: unknown): ChatRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("request must be an object");
  }
  const request = value as Partial<ChatRequest>;
  if (typeof request.model !== "string" || !Array.isArray(request.messages)) {
    throw new Error("model and messages are required");
  }
  return request as ChatRequest;
}

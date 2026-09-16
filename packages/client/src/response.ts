import {
  createResponseOpener,
  decodeResponseHead,
  parseSealedFrame,
  type ResponseFrameKind,
  type ResponseHead,
  type ResponseOpener,
  type SealedFrame,
} from "@shallot/protocol";
import { SidecarHttpError } from "./errors.ts";

function parseFrame(line: string): SealedFrame {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("Relay returned malformed response framing");
  }
  return parseSealedFrame(value);
}

async function* readNdjsonLines(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });

      let newline = pending.indexOf("\n");
      while (newline !== -1) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        if (line) yield line;
        newline = pending.indexOf("\n");
      }
    }

    pending += decoder.decode();
    const finalLine = pending.trim();
    if (finalLine) yield finalLine;
  } finally {
    reader.releaseLock();
  }
}

interface DecryptedFrame {
  kind: ResponseFrameKind;
  payload: Buffer;
}

async function* decryptResponseFrames(
  body: ReadableStream<Uint8Array>,
  responsePrivateKey: CryptoKey,
  requestId: string,
): AsyncGenerator<DecryptedFrame> {
  let expectedSequence = 0;
  let sawFinal = false;
  let opener: ResponseOpener | undefined;

  for await (const line of readNdjsonLines(body)) {
    if (sawFinal) {
      throw new Error("Relay sent data after the final response frame");
    }

    const frame = parseFrame(line);
    if (!opener) {
      if (!frame.encapsulatedKey) {
        throw new Error("first response frame is missing its encapsulated key");
      }
      opener = await createResponseOpener(
        responsePrivateKey,
        requestId,
        frame.encapsulatedKey,
      );
    }
    const payload = await opener.openFrame(frame, expectedSequence);
    expectedSequence += 1;
    sawFinal = frame.final;
    yield { kind: frame.kind, payload };
  }

  if (!sawFinal) {
    throw new Error("Relay response ended before the final frame");
  }
}

interface OpenedResponse {
  head: ResponseHead;
  data: AsyncGenerator<Buffer>;
}

async function openEncryptedResponse(
  body: ReadableStream<Uint8Array>,
  responsePrivateKey: CryptoKey,
  requestId: string,
): Promise<OpenedResponse> {
  const frames = decryptResponseFrames(body, responsePrivateKey, requestId);
  const first = await frames.next();
  if (first.done || first.value.kind !== "head") {
    throw new Error("encrypted response is missing its head frame");
  }

  async function* data(): AsyncGenerator<Buffer> {
    for await (const frame of frames) {
      if (frame.kind !== "data") {
        throw new Error("encrypted response contains an unexpected head frame");
      }
      if (frame.payload.byteLength > 0) yield frame.payload;
    }
  }

  return { head: decodeResponseHead(first.value.payload), data: data() };
}

export async function createStreamingResponse(
  body: ReadableStream<Uint8Array>,
  responsePrivateKey: CryptoKey,
  requestId: string,
): Promise<Response> {
  let opened: OpenedResponse;
  try {
    opened = await openEncryptedResponse(body, responsePrivateKey, requestId);
  } catch {
    throw new SidecarHttpError(
      502,
      "Relay returned an invalid encrypted response",
      "upstream_error",
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of opened.data) {
          controller.enqueue(chunk);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    status: opened.head.status,
    headers: {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": opened.head.contentType,
      "x-accel-buffering": "no",
    },
  });
}

export async function createBufferedResponse(
  body: ReadableStream<Uint8Array>,
  responsePrivateKey: CryptoKey,
  requestId: string,
): Promise<Response> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  let opened: OpenedResponse;

  try {
    opened = await openEncryptedResponse(body, responsePrivateKey, requestId);
    for await (const chunk of opened.data) {
      chunks.push(chunk);
      totalLength += chunk.byteLength;
    }
  } catch {
    throw new SidecarHttpError(
      502,
      "Relay returned an invalid encrypted response",
      "upstream_error",
    );
  }

  const responseBody = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    responseBody.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new Response(responseBody, {
    status: opened.head.status,
    headers: { "content-type": opened.head.contentType },
  });
}

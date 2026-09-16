import {
  createResponseSealer,
  encodeResponseHead,
  SEALED_STREAM_CONTENT_TYPE,
} from "@shallot/protocol";
import { ByteQueue } from "./byte-queue.ts";

interface ResponseSealingConfig {
  responsePaddingBytes: number;
  responseFlushMs: number;
  maxProviderResponseBytes: number;
}

interface ReadResult {
  done?: boolean;
  value?: Uint8Array;
}

async function waitForRead(
  pendingRead: Promise<ReadResult>,
  timeoutMs: number | undefined,
): Promise<{ type: "read"; result: ReadResult } | { type: "timeout" }> {
  if (timeoutMs === undefined) {
    return { type: "read", result: await pendingRead };
  }

  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => resolve({ type: "timeout" }), timeoutMs);
    pendingRead.then(
      (result) => {
        clearTimeout(timeout);
        resolve({ type: "read", result });
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function* coalesceResponseBody(
  body: ReadableStream<Uint8Array> | null,
  maxFramePayloadBytes: number,
  flushMs: number,
  maxResponseBytes: number,
): AsyncGenerator<Buffer> {
  if (!body) return;

  const reader = body.getReader();
  const queue = new ByteQueue();
  let totalBytes = 0;
  let pendingRead = reader.read();
  let reachedEnd = false;

  try {
    while (true) {
      while (queue.length >= maxFramePayloadBytes) {
        yield queue.take(maxFramePayloadBytes);
      }

      const event = await waitForRead(
        pendingRead,
        queue.length > 0 ? flushMs : undefined,
      );
      if (event.type === "timeout") {
        yield queue.take(maxFramePayloadBytes);
        continue;
      }

      if (event.result.done === true) {
        reachedEnd = true;
        break;
      }
      if (!event.result.value) throw new Error("provider stream returned no data");
      totalBytes += event.result.value.byteLength;
      if (totalBytes > maxResponseBytes) {
        await reader.cancel("provider response exceeded the configured limit");
        throw new Error("provider response is too large");
      }
      queue.push(event.result.value);
      pendingRead = reader.read();
    }

    while (queue.length > 0) {
      yield queue.take(maxFramePayloadBytes);
    }
  } finally {
    if (!reachedEnd) {
      await reader.cancel("encrypted response consumer stopped").catch(() => undefined);
    }
    reader.releaseLock();
  }
}

function serializeFrame(frame: unknown): Uint8Array {
  return Buffer.from(`${JSON.stringify(frame)}\n`);
}

function responseContentType(
  response: Response,
): "application/json" | "text/event-stream; charset=utf-8" {
  return response.headers.get("content-type")?.startsWith("text/event-stream")
    ? "text/event-stream; charset=utf-8"
    : "application/json";
}

export async function sealProviderResponse(
  providerResponse: Response,
  responsePublicKey: CryptoKey,
  requestId: string,
  config: ResponseSealingConfig,
): Promise<Response> {
  const sealer = await createResponseSealer(responsePublicKey, requestId);
  const maxPayloadBytes = config.responsePaddingBytes - 4;
  if (maxPayloadBytes <= 0) {
    throw new Error("response padding must leave room for a length prefix");
  }

  const chunks = coalesceResponseBody(
    providerResponse.body,
    maxPayloadBytes,
    config.responseFlushMs,
    config.maxProviderResponseBytes,
  );
  let sentHead = false;
  let sequence = 1;
  let currentChunk: IteratorResult<Buffer> | undefined;
  let finished = false;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!sentHead) {
          const head = await sealer.sealFrame(
            encodeResponseHead({
              status: providerResponse.status,
              contentType: responseContentType(providerResponse),
            }),
            0,
            "head",
            false,
            config.responsePaddingBytes,
          );
          sentHead = true;
          controller.enqueue(serializeFrame(head));
          return;
        }

        currentChunk ??= await chunks.next();
        const nextChunk = currentChunk.done ? currentChunk : await chunks.next();
        const payload = currentChunk.done ? new Uint8Array() : currentChunk.value;
        const frame = await sealer.sealFrame(
          payload,
          sequence,
          "data",
          nextChunk.done === true,
          config.responsePaddingBytes,
        );
        controller.enqueue(serializeFrame(frame));
        sequence += 1;
        currentChunk = nextChunk;

        if (nextChunk.done === true) {
          finished = true;
          controller.close();
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      if (finished) return;
      await chunks.return(undefined);
      if (providerResponse.body && !providerResponse.body.locked) {
        await providerResponse.body.cancel(reason).catch(() => undefined);
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": SEALED_STREAM_CONTENT_TYPE,
    },
  });
}

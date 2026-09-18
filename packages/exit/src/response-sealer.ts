import {
  createDebugLogger,
  type DebugLogger,
  formatBodyForDebug,
  formatCiphertextPreview,
} from "@shallot/observability";
import {
  createResponseSealer,
  encodeResponseHead,
  SEALED_STREAM_CONTENT_TYPE,
} from "@shallot/protocol";
import { ByteQueue } from "./byte-queue.ts";

interface ResponseSealingConfig {
  responsePaddingBytes: number;
  responseFlushMs: number;
  maxResponseBytes: number;
}

/**
 * Converts a provider response into the encrypted frame stream consumed by the
 * Sidecar. Frame zero authenticates the provider status and content type. Data
 * frames are padded to a fixed size and pulled only when the downstream reader
 * asks for them.
 *
 * Cancelling the returned body cancels the provider body and releases its
 * reader lock.
 */
export async function sealProviderResponse(
  providerResponse: Response,
  responsePublicKey: CryptoKey,
  requestId: string,
  config: ResponseSealingConfig,
  logger: DebugLogger = createDebugLogger("exit"),
): Promise<Response> {
  const sealer = await createResponseSealer(responsePublicKey, requestId);
  const maxPayloadBytes = config.responsePaddingBytes - 4;
  if (maxPayloadBytes <= 0) {
    throw new Error("response padding must leave room for a length prefix");
  }

  const cancellation = new AbortController();
  const chunks = coalesceResponseBody(
    providerResponse.body,
    maxPayloadBytes,
    config.responseFlushMs,
    config.maxResponseBytes,
    cancellation.signal,
  );
  let sentHead = false;
  let sequence = 1;
  let finished = false;
  const debugDecoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!sentHead) {
          // The Sidecar needs authenticated HTTP metadata before it can expose
          // the response body to the AI SDK.
          logger.debug("provider.response.received", {
            requestId,
            status: providerResponse.status,
            contentType: responseContentType(providerResponse),
            tenantId: "unknown",
          });
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
          logger.debug("response.frame.encrypted", {
            requestId,
            sequence: 0,
            kind: "head",
            answer: formatCiphertextPreview(head.ciphertext),
          });
          controller.enqueue(serializeFrame(head));
          return;
        }

        const chunk = await chunks.next();
        // An empty final frame authenticates the end of the stream, including
        // a provider response with no body.
        const payload = chunk.done ? new Uint8Array() : chunk.value;
        logger.debug("provider.response.chunk", {
          requestId,
          tenantId: "unknown",
          final: chunk.done === true,
          plaintext: formatBodyForDebug(
            debugDecoder.decode(payload, { stream: chunk.done !== true }),
          ),
        });
        const frame = await sealer.sealFrame(
          payload,
          sequence,
          "data",
          chunk.done === true,
          config.responsePaddingBytes,
        );
        logger.debug("response.frame.encrypted", {
          requestId,
          sequence,
          kind: "data",
          final: chunk.done === true,
          answer: formatCiphertextPreview(frame.ciphertext),
        });
        controller.enqueue(serializeFrame(frame));
        sequence += 1;

        if (chunk.done === true) {
          finished = true;
          controller.close();
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      if (finished) return;
      cancellation.abort(reason);
      // Returning the generator runs its finally block, which cancels the
      // provider reader and releases its lock.
      await chunks.return(undefined);
      if (providerResponse.body && !providerResponse.body.locked) {
        // The generator may not have started if the client cancelled after the
        // head frame, so cancel the untouched body here as well.
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

/**
 * Rechunks the provider body into payloads that fit inside padded response
 * frames. Full payloads are emitted immediately. A partial payload is emitted
 * after the flush interval so a slow token stream does not stall.
 *
 * The generator keeps at most one provider read in flight and rejects the
 * stream as soon as the cumulative plaintext limit is exceeded.
 */
async function* coalesceResponseBody(
  body: ReadableStream<Uint8Array> | null,
  maxFramePayloadBytes: number,
  flushMs: number,
  maxResponseBytes: number,
  signal: AbortSignal,
): AsyncGenerator<Buffer> {
  if (!body) return;

  const reader = body.getReader();
  const queue = new ByteQueue();
  let totalBytes = 0;
  let pendingRead = reader.read();
  let reachedEnd = false;
  const cancelReader = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  if (signal.aborted) cancelReader();
  else signal.addEventListener("abort", cancelReader, { once: true });

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
        // The pending read still owns the next provider chunk. Reuse it after
        // flushing instead of starting a second read on the same reader.
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
        // Stop the source before reporting the limit failure downstream.
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
    signal.removeEventListener("abort", cancelReader);
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

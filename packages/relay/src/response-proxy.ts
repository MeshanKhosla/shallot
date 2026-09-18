import type { RequestPermit } from "./concurrency-limiter.ts";

/**
 * Proxies an encrypted response without buffering it. The stream owns the
 * Relay concurrency permit and releases it once on completion, failure, or
 * downstream cancellation.
 */
export function proxyResponseBody(
  body: ReadableStream<Uint8Array>,
  permit: RequestPermit,
  observe?: (chunk: Uint8Array) => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let finished = false;

  async function finish(reason?: unknown, cancelReader = false): Promise<void> {
    if (finished) return;
    finished = true;
    permit.release();

    try {
      if (cancelReader) await reader.cancel(reason);
    } catch {
      // The permit and lock still need to be released.
    } finally {
      reader.releaseLock();
    }
  }

  return new ReadableStream({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (finished) return;

        if (result.done) {
          await finish();
          controller.close();
          return;
        }

        observe?.(result.value);
        controller.enqueue(result.value);
      } catch (error) {
        if (finished) return;
        await finish(error, true);
        controller.error(error);
      }
    },
    async cancel(reason) {
      await finish(reason, true);
    },
  });
}

import { Effect, Fiber } from "effect";

export interface Deadline {
  readonly signal: AbortSignal;
  readonly expired: boolean;
  readonly cancel: Effect.Effect<void>;
}

export function makeDeadline(timeoutMs: number): Effect.Effect<Deadline> {
  return Effect.gen(function* () {
    const controller = new AbortController();
    const fiber = yield* Effect.sleep(timeoutMs).pipe(
      Effect.tap(() => Effect.sync(() => controller.abort("upstream request timed out"))),
      Effect.forkDetach,
    );

    return {
      signal: controller.signal,
      get expired() {
        return controller.signal.aborted;
      },
      cancel: Fiber.interrupt(fiber).pipe(Effect.asVoid),
    };
  });
}

export function keepDeadlineUntilStreamEnds(
  body: ReadableStream<Uint8Array>,
  deadline: Deadline,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let finished = false;

  async function finish(reason?: unknown, cancelReader = false): Promise<void> {
    if (finished) return;
    finished = true;
    await Effect.runPromise(deadline.cancel);
    try {
      if (cancelReader) await reader.cancel(reason);
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
        controller.enqueue(result.value);
      } catch (error) {
        await finish(error, true).catch(() => undefined);
        controller.error(error);
      }
    },
    async cancel(reason) {
      await finish(reason, true);
    },
  });
}

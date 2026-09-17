import { Clock, Context, Effect, Layer } from "effect";
import { ExitReplayCapacityExhausted } from "./errors.ts";
import { MemoryReplayCache, ReplayCacheCapacityError } from "./replay-cache.ts";

export class ReplayProtection extends Context.Service<
  ReplayProtection,
  {
    claim(key: string): Effect.Effect<boolean, ExitReplayCapacityExhausted>;
  }
>()("@shallot/exit/ReplayProtection") {}

export function replayProtectionLayer(config: {
  readonly ttlMs: number;
  readonly maxEntries: number;
}): Layer.Layer<ReplayProtection> {
  const cache = new MemoryReplayCache(config.ttlMs, config.maxEntries);
  return Layer.succeed(ReplayProtection, {
    claim: (key) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        return yield* Effect.try({
          try: () => cache.claim(key, now),
          catch: (cause) => {
            if (cause instanceof ReplayCacheCapacityError) {
              return new ExitReplayCapacityExhausted();
            }
            throw cause;
          },
        });
      }),
  });
}

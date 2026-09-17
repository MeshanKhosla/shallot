import { Context, Effect, Layer } from "effect";
import { ExitReplayCapacityExhausted } from "./errors.ts";
import { type ReplayCache, ReplayCacheCapacityError } from "./replay-cache.ts";

export class ReplayProtection extends Context.Service<
  ReplayProtection,
  {
    claim(key: string): Effect.Effect<boolean, ExitReplayCapacityExhausted>;
  }
>()("@shallot/exit/ReplayProtection") {}

export function replayProtectionLayer(cache: ReplayCache): Layer.Layer<ReplayProtection> {
  return Layer.succeed(ReplayProtection, {
    claim: (key) =>
      Effect.try({
        try: () => cache.claim(key),
        catch: (cause) => {
          if (cause instanceof ReplayCacheCapacityError) {
            return new ExitReplayCapacityExhausted();
          }
          throw cause;
        },
      }),
  });
}

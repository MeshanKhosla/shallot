import { Context, Effect, Layer } from "effect";
import { RelayConcurrencyExhausted } from "./errors.ts";

export interface RequestPermit {
  release(): void;
}

export class ConcurrencyLimiter extends Context.Service<
  ConcurrencyLimiter,
  {
    acquire(): Effect.Effect<RequestPermit, RelayConcurrencyExhausted>;
    readonly activeCount: Effect.Effect<number>;
  }
>()("@shallot/relay/ConcurrencyLimiter") {}

export function concurrencyLimiterLayer(
  maxConcurrentRequests: number,
): Layer.Layer<ConcurrencyLimiter> {
  return Layer.effect(
    ConcurrencyLimiter,
    Effect.sync(() => {
      let activeRequests = 0;
      return ConcurrencyLimiter.of({
        acquire: () =>
          Effect.suspend(() => {
            if (activeRequests >= maxConcurrentRequests) {
              return Effect.fail(new RelayConcurrencyExhausted());
            }
            activeRequests += 1;
            let released = false;
            return Effect.succeed({
              release() {
                if (released) return;
                released = true;
                activeRequests -= 1;
              },
            });
          }),
        activeCount: Effect.sync(() => activeRequests),
      });
    }),
  );
}

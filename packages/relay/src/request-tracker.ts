import { Clock, Context, Effect, Layer } from "effect";
import { RelayTrackerCapacityExhausted } from "./errors.ts";

export class RequestTracker extends Context.Service<
  RequestTracker,
  {
    claim(
      tenantId: string,
      requestId: string,
    ): Effect.Effect<boolean, RelayTrackerCapacityExhausted>;
  }
>()("@shallot/relay/RequestTracker") {}

export type RequestTrackerService = RequestTracker["Service"];

export class MemoryRequestTracker implements RequestTrackerService {
  private readonly entries = new Map<string, { tenantId: string; expiresAt: number }>();
  private readonly tenantCounts = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 100_000,
    private readonly maxEntriesPerTenant = 10_000,
  ) {}

  claim(
    tenantId: string,
    requestId: string,
  ): Effect.Effect<boolean, RelayTrackerCapacityExhausted> {
    const tracker = this;
    return Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      tracker.prune(now);
      const key = `${tenantId}\0${requestId}`;
      const entry = tracker.entries.get(key);
      if (entry !== undefined && entry.expiresAt > now) return false;
      if (
        tracker.entries.size >= tracker.maxEntries ||
        (tracker.tenantCounts.get(tenantId) ?? 0) >= tracker.maxEntriesPerTenant
      ) {
        return yield* new RelayTrackerCapacityExhausted();
      }
      tracker.entries.set(key, { tenantId, expiresAt: now + tracker.ttlMs });
      tracker.tenantCounts.set(tenantId, (tracker.tenantCounts.get(tenantId) ?? 0) + 1);
      return true;
    });
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt > now) break;
      this.entries.delete(key);
      const count = (this.tenantCounts.get(entry.tenantId) ?? 1) - 1;
      if (count === 0) this.tenantCounts.delete(entry.tenantId);
      else this.tenantCounts.set(entry.tenantId, count);
    }
  }
}

export interface RequestTrackerConfig {
  readonly ttlMs: number;
  readonly maxEntries: number;
  readonly maxEntriesPerTenant: number;
}

export function requestTrackerLayer(
  config: RequestTrackerConfig,
): Layer.Layer<RequestTracker> {
  return Layer.sync(
    RequestTracker,
    () =>
      new MemoryRequestTracker(
        config.ttlMs,
        config.maxEntries,
        config.maxEntriesPerTenant,
      ),
  );
}

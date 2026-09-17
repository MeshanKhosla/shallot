import { Context, Effect, Layer } from "effect";
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
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 100_000,
    private readonly maxEntriesPerTenant = 10_000,
  ) {}

  claim(
    tenantId: string,
    requestId: string,
  ): Effect.Effect<boolean, RelayTrackerCapacityExhausted> {
    return Effect.suspend(() => {
      const now = this.now();
      this.prune(now);
      const key = `${tenantId}\0${requestId}`;
      const entry = this.entries.get(key);
      if (entry !== undefined && entry.expiresAt > now) return Effect.succeed(false);
      if (
        this.entries.size >= this.maxEntries ||
        (this.tenantCounts.get(tenantId) ?? 0) >= this.maxEntriesPerTenant
      ) {
        return Effect.fail(new RelayTrackerCapacityExhausted());
      }
      this.entries.set(key, { tenantId, expiresAt: now + this.ttlMs });
      this.tenantCounts.set(tenantId, (this.tenantCounts.get(tenantId) ?? 0) + 1);
      return Effect.succeed(true);
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
  return Layer.succeed(
    RequestTracker,
    new MemoryRequestTracker(
      config.ttlMs,
      Date.now,
      config.maxEntries,
      config.maxEntriesPerTenant,
    ),
  );
}

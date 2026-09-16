export interface RequestTracker {
  claim(tenantId: string, requestId: string): boolean;
}

export class RequestTrackerCapacityError extends Error {}

export class MemoryRequestTracker implements RequestTracker {
  private readonly entries = new Map<string, { tenantId: string; expiresAt: number }>();
  private readonly tenantCounts = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 100_000,
    private readonly maxEntriesPerTenant = 10_000,
  ) {}

  claim(tenantId: string, requestId: string): boolean {
    const now = this.now();
    this.prune(now);
    const key = `${tenantId}\0${requestId}`;
    const entry = this.entries.get(key);
    if (entry !== undefined && entry.expiresAt > now) return false;
    if (
      this.entries.size >= this.maxEntries ||
      (this.tenantCounts.get(tenantId) ?? 0) >= this.maxEntriesPerTenant
    ) {
      throw new RequestTrackerCapacityError("Relay request tracker is full");
    }
    this.entries.set(key, { tenantId, expiresAt: now + this.ttlMs });
    this.tenantCounts.set(tenantId, (this.tenantCounts.get(tenantId) ?? 0) + 1);
    return true;
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

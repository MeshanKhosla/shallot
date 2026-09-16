export interface RequestTracker {
  claim(tenantId: string, requestId: string): boolean;
}

export class MemoryRequestTracker implements RequestTracker {
  private readonly expiresAt = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  claim(tenantId: string, requestId: string): boolean {
    const now = this.now();
    this.prune(now);
    const key = `${tenantId}\0${requestId}`;
    const expiry = this.expiresAt.get(key);
    if (expiry !== undefined && expiry > now) return false;
    this.expiresAt.set(key, now + this.ttlMs);
    return true;
  }

  private prune(now: number): void {
    for (const [key, expiry] of this.expiresAt) {
      if (expiry <= now) this.expiresAt.delete(key);
    }
  }
}

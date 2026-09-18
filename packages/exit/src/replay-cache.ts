export interface ReplayCache {
  claim(key: string, now: number): boolean;
}

export class ReplayCacheCapacityError extends Error {}

export class MemoryReplayCache implements ReplayCache {
  private readonly expiresAt = new Map<string, number>();
  private lastObservedTime = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 100_000,
  ) {}

  claim(key: string, observedTime: number): boolean {
    const now = Math.max(observedTime, this.lastObservedTime);
    this.lastObservedTime = now;
    this.prune(now);

    const expiry = this.expiresAt.get(key);
    if (expiry !== undefined && expiry > now) return false;
    if (this.expiresAt.size >= this.maxEntries) {
      throw new ReplayCacheCapacityError("Exit replay cache is full");
    }
    this.expiresAt.set(key, now + this.ttlMs);
    return true;
  }

  private prune(now: number): void {
    // Fixed TTLs and nondecreasing observed time order entries by expiration.
    for (const [key, expiry] of this.expiresAt) {
      if (expiry > now) break;
      this.expiresAt.delete(key);
    }
  }
}

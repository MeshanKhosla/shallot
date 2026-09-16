export interface ReplayCache {
  claim(key: string): boolean;
}

export class MemoryReplayCache implements ReplayCache {
  private readonly expiresAt = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  claim(key: string): boolean {
    const now = this.now();
    this.prune(now);

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

/**
 * In-memory token bucket per API key (one Node process serves the API, so no shared store is needed).
 * A bucket holds `capacity` requests and refills `perSecond`; idle buckets are dropped.
 */
export class TokenBuckets {
  private buckets = new Map<string, { tokens: number; at: number }>()
  private prunedAt = 0

  constructor(
    readonly capacity = 120,
    readonly perSecond = 2,
    private now: () => number = Date.now,
  ) {}

  /** Takes one token. Returns 0 when allowed, otherwise the seconds until the next token. */
  take(key: string): number {
    const t = this.now()
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: t }
    b.tokens = Math.min(this.capacity, b.tokens + ((t - b.at) / 1000) * this.perSecond)
    b.at = t
    this.buckets.set(key, b)
    // at most one sweep per second, so many keys cannot turn every request into a full scan
    if (this.buckets.size > 10_000 && t - this.prunedAt > 1000) this.prune(t)
    if (b.tokens >= 1) {
      b.tokens -= 1
      return 0
    }
    return Math.max(1, Math.ceil((1 - b.tokens) / this.perSecond))
  }

  private prune(t: number) {
    this.prunedAt = t
    const full = (this.capacity / this.perSecond) * 1000
    for (const [k, b] of this.buckets) if (t - b.at > full) this.buckets.delete(k)
  }

  reset() {
    this.buckets.clear()
  }
}

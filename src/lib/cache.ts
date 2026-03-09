type CacheEntry<TValue> = {
  value: TValue
  expiresAt: number
}

export type TtlCacheOptions = {
  defaultTtlMs: number
}

export class TtlCache<TKey extends string, TValue> {
  private readonly store = new Map<TKey, CacheEntry<TValue>>()
  private readonly inflight = new Map<TKey, Promise<TValue>>()
  private readonly defaultTtlMs: number

  constructor(options: TtlCacheOptions) {
    this.defaultTtlMs = options.defaultTtlMs
  }

  get(key: TKey): TValue | null {
    const existing = this.store.get(key)
    if (!existing) {
      return null
    }

    if (existing.expiresAt <= Date.now()) {
      this.store.delete(key)
      return null
    }

    return existing.value
  }

  set(key: TKey, value: TValue, ttlMs = this.defaultTtlMs): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + Math.max(1, ttlMs),
    })
  }

  delete(key: TKey): void {
    this.store.delete(key)
    this.inflight.delete(key)
  }

  clear(): void {
    this.store.clear()
    this.inflight.clear()
  }

  async getOrSet(key: TKey, producer: () => Promise<TValue>, ttlMs = this.defaultTtlMs): Promise<TValue> {
    const cached = this.get(key)
    if (cached !== null) {
      return cached
    }

    const pending = this.inflight.get(key)
    if (pending) {
      return pending
    }

    const nextPromise = producer()
      .then((value) => {
        this.set(key, value, ttlMs)
        this.inflight.delete(key)
        return value
      })
      .catch((error) => {
        this.inflight.delete(key)
        throw error
      })

    this.inflight.set(key, nextPromise)
    return nextPromise
  }
}

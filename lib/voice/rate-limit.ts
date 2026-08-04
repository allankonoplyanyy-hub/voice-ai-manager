// Ограничение частоты запросов.
// Реализация in-process (token bucket). Осознанная граница: при нескольких
// инстансах лимит применяется на каждый инстанс отдельно. Для распределённого
// лимита нужен Redis/Upstash — это помечено как planned, а не выдаётся за готовое.

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSec: number
}

interface Bucket {
  tokens: number
  updatedAt: number
}

export interface RateLimiterOptions {
  /** Ёмкость ведра — максимум запросов в burst. */
  capacity: number
  /** Скорость пополнения, токенов в секунду. */
  refillPerSec: number
}

/**
 * Token bucket: допускает короткий burst до capacity, затем сглаживает поток
 * до refillPerSec. Это точнее фиксированного окна, которое пропускает двойной
 * залп на стыке окон.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>()

  constructor(private readonly options: RateLimiterOptions) {}

  check(key: string, now = Date.now()): RateLimitResult {
    const { capacity, refillPerSec } = this.options
    const bucket = this.buckets.get(key) ?? { tokens: capacity, updatedAt: now }

    const elapsedSec = Math.max(0, (now - bucket.updatedAt) / 1000)
    const tokens = Math.min(capacity, bucket.tokens + elapsedSec * refillPerSec)

    if (tokens < 1) {
      // Сколько ждать до появления одного токена.
      const deficit = 1 - tokens
      const retryAfterSec = Math.ceil(deficit / refillPerSec)
      this.buckets.set(key, { tokens, updatedAt: now })
      return { allowed: false, remaining: 0, retryAfterSec }
    }

    this.buckets.set(key, { tokens: tokens - 1, updatedAt: now })
    return { allowed: true, remaining: Math.floor(tokens - 1), retryAfterSec: 0 }
  }

  /** Удаляет неактивные ведра, чтобы карта не росла бесконечно. */
  sweep(olderThanMs = 600_000, now = Date.now()): number {
    let removed = 0
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.updatedAt > olderThanMs) {
        this.buckets.delete(key)
        removed++
      }
    }
    return removed
  }

  reset(): void {
    this.buckets.clear()
  }

  get size(): number {
    return this.buckets.size
  }
}

/** Лимит на входящие вебхуки провайдера: 30 запросов в секунду на компанию. */
export const webhookLimiter = new RateLimiter({ capacity: 30, refillPerSec: 30 })

/** Лимит на административные операции: 10 запросов в секунду. */
export const adminLimiter = new RateLimiter({ capacity: 10, refillPerSec: 5 })

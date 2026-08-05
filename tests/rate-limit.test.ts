// Тесты token bucket с инжектируемым временем.
// Реальные таймеры здесь недопустимы: тест на задержках проверял бы скорость
// машины, а не логику лимита.

import { describe, expect, it } from "vitest"
import { RateLimiter } from "@/lib/voice/rate-limit"

describe("RateLimiter", () => {
  it("пропускает burst до ёмкости ведра", () => {
    const limiter = new RateLimiter({ capacity: 5, refillPerSec: 1 })
    const t = 1_000_000
    for (let i = 0; i < 5; i++) {
      expect(limiter.check("k", t).allowed).toBe(true)
    }
  })

  it("отклоняет запрос сверх ёмкости", () => {
    const limiter = new RateLimiter({ capacity: 3, refillPerSec: 1 })
    const t = 1_000_000
    limiter.check("k", t)
    limiter.check("k", t)
    limiter.check("k", t)
    const denied = limiter.check("k", t)
    expect(denied.allowed).toBe(false)
    expect(denied.remaining).toBe(0)
    expect(denied.retryAfterSec).toBeGreaterThan(0)
  })

  it("пополняет ведро со временем", () => {
    const limiter = new RateLimiter({ capacity: 2, refillPerSec: 1 })
    const t = 1_000_000
    limiter.check("k", t)
    limiter.check("k", t)
    expect(limiter.check("k", t).allowed).toBe(false)
    // Через секунду появляется ровно один токен.
    expect(limiter.check("k", t + 1000).allowed).toBe(true)
    expect(limiter.check("k", t + 1000).allowed).toBe(false)
  })

  it("не пополняет ведро выше ёмкости", () => {
    const limiter = new RateLimiter({ capacity: 2, refillPerSec: 10 })
    const t = 1_000_000
    limiter.check("k", t)
    // Долгая пауза не должна давать больше, чем capacity.
    expect(limiter.check("k", t + 60_000).allowed).toBe(true)
    expect(limiter.check("k", t + 60_000).allowed).toBe(true)
    expect(limiter.check("k", t + 60_000).allowed).toBe(false)
  })

  it("КРИТИЧНО: ведра изолированы по ключу", () => {
    const limiter = new RateLimiter({ capacity: 1, refillPerSec: 1 })
    const t = 1_000_000
    expect(limiter.check("company_a", t).allowed).toBe(true)
    expect(limiter.check("company_a", t).allowed).toBe(false)
    // Исчерпание лимита одной компанией не должно блокировать другую.
    expect(limiter.check("company_b", t).allowed).toBe(true)
  })

  it("retryAfterSec не бывает нулевым при отказе", () => {
    const limiter = new RateLimiter({ capacity: 1, refillPerSec: 0.5 })
    const t = 1_000_000
    limiter.check("k", t)
    const denied = limiter.check("k", t)
    expect(denied.allowed).toBe(false)
    expect(denied.retryAfterSec).toBeGreaterThanOrEqual(1)
  })

  it("sweep удаляет неактивные ведра", () => {
    const limiter = new RateLimiter({ capacity: 1, refillPerSec: 1 })
    const t = 1_000_000
    limiter.check("old", t)
    const now = t + 900_000
    limiter.check("fresh", now)
    expect(limiter.size).toBe(2)

    // Порог 600 с: "old" неактивно 900 с и удаляется, "fresh" только что создано.
    const removed = limiter.sweep(600_000, now)
    expect(removed).toBe(1)
    expect(limiter.size).toBe(1)
  })

  it("reset очищает все ведра", () => {
    const limiter = new RateLimiter({ capacity: 1, refillPerSec: 1 })
    limiter.check("a")
    limiter.check("b")
    limiter.reset()
    expect(limiter.size).toBe(0)
  })
})

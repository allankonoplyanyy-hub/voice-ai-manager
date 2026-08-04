import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"

import { db, pool } from "@/lib/db"
import { voiceCompanies, voiceOutboxEvents } from "@/lib/db/schema"
import {
  claimDueEvents,
  drainOutbox,
  enqueueEvent,
  markFailed,
  outboxStats,
  reclaimStaleEvents,
  replayDeadLetter,
  type DeliveryTarget,
} from "@/lib/voice/outbox"

const COMPANY = "test_outbox_co"
const WEBHOOK = "https://control-center.invalid/hook"

async function resetCompany() {
  await db.delete(voiceOutboxEvents).where(eq(voiceOutboxEvents.companyId, COMPANY))
  await db
    .insert(voiceCompanies)
    .values({ companyId: COMPANY, name: "Outbox Test", webhookUrl: WEBHOOK, active: true })
    .onConflictDoUpdate({
      target: voiceCompanies.companyId,
      set: { webhookUrl: WEBHOOK, active: true },
    })
}

async function statusOf(eventId: string): Promise<string> {
  const rows = await db
    .select({ status: voiceOutboxEvents.status })
    .from(voiceOutboxEvents)
    .where(eq(voiceOutboxEvents.eventId, eventId))
    .limit(1)
  return rows[0]?.status ?? "missing"
}

const target: DeliveryTarget = { url: WEBHOOK, secret: "s".repeat(32) }

beforeEach(resetCompany)

afterAll(async () => {
  await db.delete(voiceOutboxEvents).where(eq(voiceOutboxEvents.companyId, COMPANY))
  await db.delete(voiceCompanies).where(eq(voiceCompanies.companyId, COMPANY))
  await pool.end()
})

describe("enqueueEvent — идемпотентность", () => {
  it("одинаковый ключ не создаёт второе событие", async () => {
    const first = await enqueueEvent({
      companyId: COMPANY,
      type: "call.completed",
      payload: { a: 1 },
      idempotencyKey: "same-key",
    })
    const second = await enqueueEvent({
      companyId: COMPANY,
      type: "call.completed",
      payload: { a: 2 },
      idempotencyKey: "same-key",
    })

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.eventId).toBe(first.eventId)

    const all = await db.select().from(voiceOutboxEvents).where(eq(voiceOutboxEvents.companyId, COMPANY))
    expect(all).toHaveLength(1)
  })
})

describe("claimDueEvents — атомарный захват", () => {
  it("переводит захваченное событие в delivering", async () => {
    const { eventId } = await enqueueEvent({
      companyId: COMPANY,
      type: "call.completed",
      payload: {},
      idempotencyKey: "claim-1",
    })

    const claimed = await claimDueEvents(10)
    expect(claimed.map((e) => e.eventId)).toContain(eventId)
    expect(await statusOf(eventId)).toBe("delivering")
  })

  it("не выдаёт одно событие двум параллельным воркерам", async () => {
    // 5 событий, два воркера по 5 — сумма захватов не должна превысить 5.
    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      const { eventId } = await enqueueEvent({
        companyId: COMPANY,
        type: "call.completed",
        payload: { i },
        idempotencyKey: `race-${i}`,
      })
      ids.push(eventId)
    }

    const [a, b] = await Promise.all([claimDueEvents(5), claimDueEvents(5)])
    const claimedIds = [...a.map((e) => e.eventId), ...b.map((e) => e.eventId)]

    expect(claimedIds).toHaveLength(5)
    expect(new Set(claimedIds).size).toBe(5)
  })

  it("повторный захват не возвращает уже захваченные события", async () => {
    await enqueueEvent({ companyId: COMPANY, type: "t", payload: {}, idempotencyKey: "twice" })

    const first = await claimDueEvents(10)
    const second = await claimDueEvents(10)

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(0)
  })
})

describe("drainOutbox — снятие захвата", () => {
  it("возвращает событие в pending, когда доставлять некуда", async () => {
    // Регрессия: пропущенное событие оставалось в delivering и больше никогда
    // не попадало в выборку, потому что claimDueEvents берёт только pending.
    const { eventId } = await enqueueEvent({
      companyId: COMPANY,
      type: "call.completed",
      payload: {},
      idempotencyKey: "no-target",
    })

    const stats = await drainOutbox(async () => null, 10)

    expect(stats.skipped).toBe(1)
    expect(await statusOf(eventId)).toBe("pending")
  })

  it("не оставляет событие захваченным, если доставка бросила исключение", async () => {
    const { eventId } = await enqueueEvent({
      companyId: COMPANY,
      type: "call.completed",
      payload: {},
      idempotencyKey: "throws",
    })

    const throwingFetch = (() => {
      throw new Error("сеть недоступна")
    }) as unknown as typeof fetch

    const stats = await drainOutbox(async () => target, 10, throwingFetch)

    expect(stats.failed).toBe(1)
    expect(await statusOf(eventId)).not.toBe("delivering")
  })

  it("помечает delivered при успешном ответе", async () => {
    const { eventId } = await enqueueEvent({
      companyId: COMPANY,
      type: "call.completed",
      payload: {},
      idempotencyKey: "ok",
    })

    const okFetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch
    const stats = await drainOutbox(async () => target, 10, okFetch)

    expect(stats.delivered).toBe(1)
    expect(await statusOf(eventId)).toBe("delivered")
  })

  it("подписывает исходящий запрос и передаёт версию схемы", async () => {
    await enqueueEvent({ companyId: COMPANY, type: "call.completed", payload: {}, idempotencyKey: "signed" })

    let headers: Headers | null = null
    const captureFetch = (async (_url: string, init: RequestInit) => {
      headers = new Headers(init.headers)
      return new Response("{}", { status: 200 })
    }) as unknown as typeof fetch

    await drainOutbox(async () => target, 10, captureFetch)

    expect(headers).not.toBeNull()
    expect(headers!.get("x-voice-signature")).toMatch(/^v1=/)
    expect(headers!.get("x-voice-timestamp")).toBeTruthy()
  })
})

describe("reclaimStaleEvents — восстановление после падения воркера", () => {
  it("возвращает в очередь захваты, брошенные упавшим процессом", async () => {
    const { eventId } = await enqueueEvent({
      companyId: COMPANY,
      type: "call.completed",
      payload: {},
      idempotencyKey: "stale",
    })

    await claimDueEvents(10)
    expect(await statusOf(eventId)).toBe("delivering")

    // Имитируем давний захват: сдвигаем nextAttemptAt в прошлое.
    await db
      .update(voiceOutboxEvents)
      .set({ nextAttemptAt: new Date(Date.now() - 600_000) })
      .where(eq(voiceOutboxEvents.eventId, eventId))

    const reclaimed = await reclaimStaleEvents(120_000)

    expect(reclaimed).toBeGreaterThanOrEqual(1)
    expect(await statusOf(eventId)).toBe("pending")
  })

  it("не трогает свежие захваты", async () => {
    const { eventId } = await enqueueEvent({
      companyId: COMPANY,
      type: "call.completed",
      payload: {},
      idempotencyKey: "fresh-claim",
    })
    await claimDueEvents(10)

    await reclaimStaleEvents(120_000)

    expect(await statusOf(eventId)).toBe("delivering")
  })
})

describe("markFailed — ретраи и dead-letter", () => {
  it("уводит в dead_letter после исчерпания попыток", async () => {
    const { eventId } = await enqueueEvent({
      companyId: COMPANY,
      type: "call.completed",
      payload: {},
      idempotencyKey: "exhaust",
      maxAttempts: 2,
    })

    const first = await markFailed(eventId, "500")
    expect(first.deadLettered).toBe(false)
    expect(await statusOf(eventId)).toBe("pending")

    const second = await markFailed(eventId, "500")
    expect(second.deadLettered).toBe(true)
    expect(await statusOf(eventId)).toBe("dead_letter")
  })

  it("обрезает слишком длинный текст ошибки", async () => {
    const { eventId } = await enqueueEvent({
      companyId: COMPANY,
      type: "t",
      payload: {},
      idempotencyKey: "long-err",
    })
    await markFailed(eventId, "x".repeat(5000))

    const rows = await db
      .select({ lastError: voiceOutboxEvents.lastError })
      .from(voiceOutboxEvents)
      .where(eq(voiceOutboxEvents.eventId, eventId))
    expect(rows[0].lastError!.length).toBeLessThanOrEqual(500)
  })
})

describe("replayDeadLetter — ручной подъём", () => {
  it("возвращает застрявшие события в очередь", async () => {
    const { eventId } = await enqueueEvent({
      companyId: COMPANY,
      type: "t",
      payload: {},
      idempotencyKey: "replay-me",
      maxAttempts: 1,
    })
    await markFailed(eventId, "boom")
    expect(await statusOf(eventId)).toBe("dead_letter")

    const replayed = await replayDeadLetter(COMPANY, [eventId])

    expect(replayed).toBe(1)
    expect(await statusOf(eventId)).toBe("pending")
  })

  it("не поднимает события чужой компании", async () => {
    const { eventId } = await enqueueEvent({
      companyId: COMPANY,
      type: "t",
      payload: {},
      idempotencyKey: "other-tenant",
      maxAttempts: 1,
    })
    await markFailed(eventId, "boom")

    const replayed = await replayDeadLetter("someone_else", [eventId])

    expect(replayed).toBe(0)
    expect(await statusOf(eventId)).toBe("dead_letter")
  })
})

describe("outboxStats", () => {
  it("считает события только запрошенной компании", async () => {
    await enqueueEvent({ companyId: COMPANY, type: "t", payload: {}, idempotencyKey: "s1" })
    await enqueueEvent({ companyId: COMPANY, type: "t", payload: {}, idempotencyKey: "s2" })

    const stats = await outboxStats(COMPANY)
    expect(stats.pending).toBe(2)

    const empty = await outboxStats("nobody_here")
    expect(empty.pending).toBe(0)
  })
})

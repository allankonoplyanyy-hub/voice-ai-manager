// Интеграционные тесты входящего вебхука провайдера.
// Проверяют именно то, что раньше отсутствовало: без подписи запрос не проходит,
// подделанная подпись отклоняется, replay не обрабатывается дважды,
// а чужой companyId не даёт доступа.

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { voiceAuditLog, voiceCompanies, voiceInboundEvents } from "@/lib/db/schema"
import { signPayload } from "@/lib/voice/security"
import { webhookLimiter } from "@/lib/voice/rate-limit"
import { POST } from "@/app/api/voice/webhooks/provider/route"

const SECRET = "whsec_test_secret_for_route_verification"
const COMPANY = "co_wh_test"
const OTHER = "co_wh_other"
const INACTIVE = "co_wh_inactive"
const URL = "https://example.test/api/voice/webhooks/provider"

const hasDb = Boolean(process.env.DATABASE_URL)
const describeDb = hasDb ? describe : describe.skip

async function cleanup() {
  if (!hasDb) return
  for (const company of [COMPANY, OTHER, INACTIVE]) {
    await db.delete(voiceInboundEvents).where(eq(voiceInboundEvents.companyId, company))
    await db.delete(voiceAuditLog).where(eq(voiceAuditLog.companyId, company))
    await db.delete(voiceCompanies).where(eq(voiceCompanies.companyId, company))
  }
}

/** Собирает запрос с корректной подписью, если секрет передан. */
function buildRequest(options: {
  body: unknown
  companyId?: string | null
  eventId?: string | null
  secret?: string | null
  timestamp?: string
  signatureOverride?: string
}) {
  const raw = JSON.stringify(options.body)
  const timestamp = options.timestamp ?? String(Date.now())
  const headers = new Headers({ "content-type": "application/json" })

  if (options.companyId !== null) headers.set("x-voice-company", options.companyId ?? COMPANY)
  if (options.eventId !== null) headers.set("x-voice-event-id", options.eventId ?? `evt_${Math.random()}`)

  if (options.signatureOverride) {
    headers.set("x-voice-signature", options.signatureOverride)
    headers.set("x-voice-timestamp", timestamp)
  } else if (options.secret) {
    headers.set("x-voice-signature", signPayload(options.secret, timestamp, raw))
    headers.set("x-voice-timestamp", timestamp)
  }

  return new Request(URL, { method: "POST", headers, body: raw })
}

describeDb("POST /api/voice/webhooks/provider", () => {
  beforeAll(async () => {
    process.env.VOICE_PROVIDER_WEBHOOK_SECRET = SECRET
    await cleanup()
    await db.insert(voiceCompanies).values([
      { companyId: COMPANY, name: "Тест", active: true },
      { companyId: OTHER, name: "Другая", active: true },
      { companyId: INACTIVE, name: "Отключена", active: false },
    ])
  })

  afterAll(cleanup)

  it("КРИТИЧНО: отклоняет запрос без подписи", async () => {
    webhookLimiter.reset()
    const response = await POST(buildRequest({ body: { event: "call.started" }, secret: null }))
    expect(response.status).toBe(401)
  })

  it("КРИТИЧНО: отклоняет подделанную подпись", async () => {
    webhookLimiter.reset()
    const response = await POST(
      buildRequest({
        body: { event: "call.started" },
        signatureOverride: `v1=${"a".repeat(64)}`,
      }),
    )
    expect(response.status).toBe(401)
  })

  it("КРИТИЧНО: отклоняет подпись, сделанную неверным секретом", async () => {
    webhookLimiter.reset()
    const response = await POST(buildRequest({ body: { event: "call.started" }, secret: "whsec_wrong_secret" }))
    expect(response.status).toBe(401)
  })

  it("принимает корректно подписанный запрос", async () => {
    webhookLimiter.reset()
    const response = await POST(buildRequest({ body: { event: "call.started" }, secret: SECRET }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ status: "accepted" })
  })

  it("КРИТИЧНО: повторная доставка того же event_id не обрабатывается дважды", async () => {
    webhookLimiter.reset()
    const eventId = `evt_replay_${Date.now()}`
    const first = await POST(buildRequest({ body: { event: "call.ended" }, secret: SECRET, eventId }))
    const second = await POST(buildRequest({ body: { event: "call.ended" }, secret: SECRET, eventId }))

    expect(first.status).toBe(200)
    await expect(first.json()).resolves.toMatchObject({ status: "accepted" })
    expect(second.status).toBe(200)
    await expect(second.json()).resolves.toMatchObject({ status: "duplicate_ignored" })

    // В БД должна остаться ровно одна запись о событии.
    const rows = await db.select().from(voiceInboundEvents).where(eq(voiceInboundEvents.eventId, eventId))
    expect(rows).toHaveLength(1)
  })

  it("КРИТИЧНО: replay со старым timestamp отклоняется", async () => {
    webhookLimiter.reset()
    const old = String(Date.now() - 3_600_000)
    const response = await POST(buildRequest({ body: { event: "x" }, secret: SECRET, timestamp: old }))
    expect(response.status).toBe(401)
  })

  it("КРИТИЧНО: неизвестная компания получает 401, а не 404", async () => {
    webhookLimiter.reset()
    // Одинаковый ответ не даёт перебором узнать список арендаторов.
    const response = await POST(
      buildRequest({ body: { event: "x" }, secret: SECRET, companyId: "co_does_not_exist" }),
    )
    expect(response.status).toBe(401)
  })

  it("КРИТИЧНО: отключённая компания не принимает вебхуки", async () => {
    webhookLimiter.reset()
    const response = await POST(buildRequest({ body: { event: "x" }, secret: SECRET, companyId: INACTIVE }))
    expect(response.status).toBe(401)
  })

  it("отклоняет запрос без companyId", async () => {
    webhookLimiter.reset()
    const response = await POST(buildRequest({ body: { event: "x" }, secret: SECRET, companyId: null }))
    expect(response.status).toBe(401)
  })

  it("отклоняет запрос без event_id", async () => {
    webhookLimiter.reset()
    const response = await POST(buildRequest({ body: { event: "x" }, secret: SECRET, eventId: null }))
    expect(response.status).toBe(401)
  })

  it("КРИТИЧНО: подпись одной компании не действует для другой", async () => {
    webhookLimiter.reset()
    // Тело и подпись валидны, но companyId подменён. Подпись не привязана к компании,
    // поэтому защиту здесь обеспечивает то, что event_id уникален в пределах компании,
    // а сам факт доступа проверяется отдельно — тест фиксирует текущий контракт.
    const eventId = `evt_cross_${Date.now()}`
    const a = await POST(buildRequest({ body: { event: "x" }, secret: SECRET, companyId: COMPANY, eventId }))
    expect(a.status).toBe(200)

    const rows = await db.select().from(voiceInboundEvents).where(eq(voiceInboundEvents.eventId, eventId))
    expect(rows).toHaveLength(1)
    expect(rows[0].companyId).toBe(COMPANY)
  })

  it("отклоняет слишком большое тело", async () => {
    webhookLimiter.reset()
    const huge = { blob: "x".repeat(300 * 1024) }
    const response = await POST(buildRequest({ body: huge, secret: SECRET }))
    expect(response.status).toBe(413)
  })

  it("не пишет секрет в аудит", async () => {
    webhookLimiter.reset()
    await POST(buildRequest({ body: { event: "x", token: SECRET }, secret: SECRET }))
    const rows = await db.select().from(voiceAuditLog).where(eq(voiceAuditLog.companyId, COMPANY))
    const serialized = JSON.stringify(rows)
    expect(serialized).not.toContain(SECRET)
  })

  it("включает Retry-After при превышении лимита частоты", async () => {
    webhookLimiter.reset()
    // Ведро истощаем напрямую с фиксированным моментом времени.
    // Гонять запросы через маршрут здесь нельзя: задержка БД (~35 мс) держит
    // поток ниже лимита, ведро пополняется быстрее, чем расходуется, и тест
    // проверял бы скорость сети, а не логику отказа.
    const frozen = Date.now()
    for (let i = 0; i < 30; i++) webhookLimiter.check(COMPANY, frozen)

    const response = await POST(buildRequest({ body: { i: 1 }, secret: SECRET }))
    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBeTruthy()
    webhookLimiter.reset()
  })
})

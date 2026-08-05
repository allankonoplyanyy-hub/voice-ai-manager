import { describe, expect, it } from "vitest"
import { backoffMs } from "@/lib/voice/outbox"
import { signPayload, verifyWebhook } from "@/lib/voice/security"

describe("экспоненциальная задержка ретраев", () => {
  it("растёт с номером попытки", () => {
    const samples = (attempt: number) =>
      Array.from({ length: 40 }, () => backoffMs(attempt)).reduce((a, b) => a + b, 0) / 40
    expect(samples(2)).toBeGreaterThan(samples(1))
    expect(samples(4)).toBeGreaterThan(samples(2))
  })

  it("не превышает установленный потолок", () => {
    for (let i = 0; i < 200; i++) {
      expect(backoffMs(20, 1000, 300_000)).toBeLessThanOrEqual(300_000)
    }
  })

  it("содержит джиттер — значения не идентичны", () => {
    const values = new Set(Array.from({ length: 30 }, () => backoffMs(5)))
    expect(values.size).toBeGreaterThan(1)
  })

  it("никогда не возвращает отрицательную задержку", () => {
    for (let attempt = 0; attempt < 15; attempt++) {
      expect(backoffMs(attempt)).toBeGreaterThanOrEqual(0)
    }
  })
})

describe("подписанная доставка событий совместима с проверкой на приёме", () => {
  it("получатель успешно проверяет подпись, сформированную отправителем", () => {
    const secret = "whsec_shared_between_sides"
    const timestamp = String(Date.now())
    const body = JSON.stringify({
      eventId: "evt_1",
      type: "voice.lead.created",
      schemaVersion: "1",
      payload: { leadId: "lead_1" },
    })
    const signature = signPayload(secret, timestamp, body)

    expect(
      verifyWebhook({ secret, signatureHeader: signature, timestampHeader: timestamp, rawBody: body }),
    ).toEqual({ ok: true })
  })

  it("получатель отклоняет событие, если тело изменено в пути", () => {
    const secret = "whsec_shared_between_sides"
    const timestamp = String(Date.now())
    const body = JSON.stringify({ eventId: "evt_1", payload: { amount: 100 } })
    const signature = signPayload(secret, timestamp, body)
    const tampered = JSON.stringify({ eventId: "evt_1", payload: { amount: 999999 } })

    expect(
      verifyWebhook({ secret, signatureHeader: signature, timestampHeader: timestamp, rawBody: tampered }),
    ).toEqual({ ok: false, reason: "signature_mismatch" })
  })
})

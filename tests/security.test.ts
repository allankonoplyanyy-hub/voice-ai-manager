import { describe, expect, it } from "vitest"
import {
  checkTimestamp,
  MAX_TIMESTAMP_SKEW_MS,
  signPayload,
  verifySignature,
  verifyWebhook,
} from "@/lib/voice/security"

describe("HMAC подпись", () => {
  it("подпись валидируется с тем же телом и timestamp", () => {
    const body = JSON.stringify({ callId: "c1" })
    const ts = new Date().toISOString()
    const sig = signPayload(body, ts)
    expect(verifySignature(body, ts, sig)).toBe(true)
  })

  it("изменённое тело не проходит проверку", () => {
    const ts = new Date().toISOString()
    const sig = signPayload('{"a":1}', ts)
    expect(verifySignature('{"a":2}', ts, sig)).toBe(false)
  })

  it("изменённый timestamp не проходит проверку", () => {
    const body = '{"a":1}'
    const sig = signPayload(body, "2026-07-01T00:00:00Z")
    expect(verifySignature(body, "2026-07-01T00:00:01Z", sig)).toBe(false)
  })
})

describe("timestamp / replay protection", () => {
  const now = Date.parse("2026-07-01T12:00:00Z")

  it("свежий timestamp принимается", () => {
    expect(checkTimestamp(new Date(now - 1000).toISOString(), now).ok).toBe(true)
  })

  it("устаревший timestamp отклоняется", () => {
    const old = new Date(now - MAX_TIMESTAMP_SKEW_MS - 1000).toISOString()
    expect(checkTimestamp(old, now)).toEqual({ ok: false, reason: "expired" })
  })

  it("timestamp из будущего отклоняется", () => {
    const future = new Date(now + MAX_TIMESTAMP_SKEW_MS + 1000).toISOString()
    expect(checkTimestamp(future, now)).toEqual({ ok: false, reason: "future" })
  })

  it("отсутствующий/невалидный timestamp отклоняется", () => {
    expect(checkTimestamp(undefined, now).ok).toBe(false)
    expect(checkTimestamp("not-a-date", now).ok).toBe(false)
  })
})

describe("verifyWebhook (полный цикл)", () => {
  it("корректный запрос проходит", () => {
    const body = '{"idempotencyKey":"k1"}'
    const ts = new Date().toISOString()
    const result = verifyWebhook(body, { timestamp: ts, signature: signPayload(body, ts) })
    expect(result.ok).toBe(true)
  })

  it("без подписи — 401", () => {
    const ts = new Date().toISOString()
    const result = verifyWebhook("{}", { timestamp: ts })
    expect(result).toMatchObject({ ok: false, status: 401, error: "signature_missing" })
  })

  it("replay старого запроса — 401", () => {
    const body = "{}"
    const oldTs = new Date(Date.now() - MAX_TIMESTAMP_SKEW_MS - 60_000).toISOString()
    const result = verifyWebhook(body, { timestamp: oldTs, signature: signPayload(body, oldTs) })
    expect(result).toMatchObject({ ok: false, status: 401, error: "timestamp_expired" })
  })
})

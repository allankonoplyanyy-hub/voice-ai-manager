import { describe, expect, it } from "vitest"
import {
  DEFAULT_TOLERANCE_SEC,
  MAX_WEBHOOK_BODY_BYTES,
  generateWebhookSecret,
  hashSecret,
  safeCompare,
  signPayload,
  verifySecretAgainstHash,
  verifyWebhook,
} from "@/lib/voice/security"

const SECRET = "whsec_test_secret_value_0123456789"
const BODY = JSON.stringify({ type: "voice.call.started", callId: "call_1" })

function verify(overrides: Partial<Parameters<typeof verifyWebhook>[0]> = {}) {
  const timestamp = String(Date.now())
  return verifyWebhook({
    secret: SECRET,
    signatureHeader: signPayload(SECRET, timestamp, BODY),
    timestampHeader: timestamp,
    rawBody: BODY,
    ...overrides,
  })
}

describe("подпись вебхуков", () => {
  it("принимает корректно подписанный запрос", () => {
    expect(verify()).toEqual({ ok: true })
  })

  it("подпись детерминирована для одинакового входа", () => {
    expect(signPayload(SECRET, "1700000000000", BODY)).toBe(signPayload(SECRET, "1700000000000", BODY))
  })

  it("подпись имеет версионный префикс v1 и 64 hex-символа", () => {
    const sig = signPayload(SECRET, "1700000000000", BODY)
    expect(sig).toMatch(/^v1=[0-9a-f]{64}$/)
  })

  it("отклоняет подпись, созданную другим секретом", () => {
    const timestamp = String(Date.now())
    const result = verifyWebhook({
      secret: SECRET,
      signatureHeader: signPayload("другой_секрет", timestamp, BODY),
      timestampHeader: timestamp,
      rawBody: BODY,
    })
    expect(result).toEqual({ ok: false, reason: "signature_mismatch" })
  })

  it("отклоняет изменённое тело при валидной подписи исходного тела", () => {
    const timestamp = String(Date.now())
    const result = verifyWebhook({
      secret: SECRET,
      signatureHeader: signPayload(SECRET, timestamp, BODY),
      timestampHeader: timestamp,
      rawBody: BODY.replace("call_1", "call_ЗЛОУМЫШЛЕННИК"),
    })
    expect(result).toEqual({ ok: false, reason: "signature_mismatch" })
  })

  it("timestamp входит в подпись: подмену времени обнаруживает", () => {
    const original = String(Date.now())
    const signature = signPayload(SECRET, original, BODY)
    const result = verifyWebhook({
      secret: SECRET,
      signatureHeader: signature,
      timestampHeader: String(Number(original) - 1000),
      rawBody: BODY,
    })
    expect(result).toEqual({ ok: false, reason: "signature_mismatch" })
  })

  it("отклоняет просроченный запрос (replay)", () => {
    const old = String(Date.now() - (DEFAULT_TOLERANCE_SEC + 60) * 1000)
    const result = verifyWebhook({
      secret: SECRET,
      signatureHeader: signPayload(SECRET, old, BODY),
      timestampHeader: old,
      rawBody: BODY,
    })
    expect(result).toEqual({ ok: false, reason: "expired_timestamp" })
  })

  it("отклоняет запрос из будущего", () => {
    const future = String(Date.now() + (DEFAULT_TOLERANCE_SEC + 60) * 1000)
    const result = verifyWebhook({
      secret: SECRET,
      signatureHeader: signPayload(SECRET, future, BODY),
      timestampHeader: future,
      rawBody: BODY,
    })
    expect(result).toEqual({ ok: false, reason: "future_timestamp" })
  })

  it("отклоняет отсутствующие заголовки", () => {
    expect(verify({ signatureHeader: null })).toEqual({ ok: false, reason: "missing_signature" })
    expect(verify({ timestampHeader: null })).toEqual({ ok: false, reason: "missing_timestamp" })
  })

  it("отклоняет некорректный формат подписи", () => {
    expect(verify({ signatureHeader: "мусор" })).toEqual({ ok: false, reason: "malformed_signature" })
    expect(verify({ signatureHeader: "v1=нехекс" })).toEqual({ ok: false, reason: "malformed_signature" })
    expect(verify({ signatureHeader: "v2=" + "a".repeat(64) })).toEqual({ ok: false, reason: "unsupported_version" })
  })

  it("отклоняет нечисловой timestamp", () => {
    expect(verify({ timestampHeader: "вчера" })).toEqual({ ok: false, reason: "bad_timestamp" })
  })

  it("отклоняет слишком большое тело до проверки подписи", () => {
    const huge = "x".repeat(MAX_WEBHOOK_BODY_BYTES + 1)
    expect(verify({ rawBody: huge })).toEqual({ ok: false, reason: "body_too_large" })
  })

  it("сообщает об отсутствии секрета, а не пропускает запрос", () => {
    expect(verify({ secret: null })).toEqual({ ok: false, reason: "no_secret_configured" })
    expect(verify({ secret: "" })).toEqual({ ok: false, reason: "no_secret_configured" })
  })
})

describe("safeCompare", () => {
  it("сравнивает равные строки", () => {
    expect(safeCompare("одинаково", "одинаково")).toBe(true)
  })
  it("отличает разные строки разной длины без исключения", () => {
    expect(safeCompare("коротко", "значительно длиннее")).toBe(false)
  })
})

describe("секреты компаний", () => {
  it("генерирует уникальные секреты достаточной длины", () => {
    const a = generateWebhookSecret()
    const b = generateWebhookSecret()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThan(40)
    expect(a.startsWith("whsec_")).toBe(true)
  })

  it("хеш не совпадает с самим секретом", () => {
    const secret = generateWebhookSecret()
    expect(hashSecret(secret)).not.toContain(secret)
  })

  it("проверяет секрет по хешу", () => {
    const secret = generateWebhookSecret()
    const hash = hashSecret(secret)
    expect(verifySecretAgainstHash(secret, hash)).toBe(true)
    expect(verifySecretAgainstHash(generateWebhookSecret(), hash)).toBe(false)
  })
})

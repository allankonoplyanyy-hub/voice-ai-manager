import { createHmac, timingSafeEqual } from "node:crypto"

// Безопасность webhook и исходящих событий:
// 1. HMAC-SHA256 подпись тела запроса (общий секрет per-environment).
// 2. Timestamp window: запросы старше MAX_SKEW отклоняются (replay protection).
// 3. Идемпотентность обрабатывается на уровне store (processedWebhookKeys).
//
// В demo-режиме используется детерминированный секрет по умолчанию,
// в live он ДОЛЖЕН приходить из env (VOICE_WEBHOOK_SECRET).

export const DEFAULT_DEMO_SECRET = "demo-secret-not-for-production"

export const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000 // 5 минут

export function getWebhookSecret(): string {
  return process.env.VOICE_WEBHOOK_SECRET ?? DEFAULT_DEMO_SECRET
}

/** Подпись: HMAC-SHA256(secret, `${timestamp}.${rawBody}`) в hex. */
export function signPayload(rawBody: string, timestamp: string, secret = getWebhookSecret()): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")
}

export function verifySignature(
  rawBody: string,
  timestamp: string,
  signature: string,
  secret = getWebhookSecret(),
): boolean {
  const expected = signPayload(rawBody, timestamp, secret)
  const a = Buffer.from(expected, "utf8")
  const b = Buffer.from(signature, "utf8")
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export type TimestampCheck =
  | { ok: true }
  | { ok: false; reason: "missing" | "invalid" | "expired" | "future" }

/** Replay protection: timestamp должен быть в окне ±MAX_TIMESTAMP_SKEW_MS. */
export function checkTimestamp(timestamp: string | undefined, now = Date.now()): TimestampCheck {
  if (!timestamp) return { ok: false, reason: "missing" }
  const ts = Date.parse(timestamp)
  if (Number.isNaN(ts)) return { ok: false, reason: "invalid" }
  if (now - ts > MAX_TIMESTAMP_SKEW_MS) return { ok: false, reason: "expired" }
  if (ts - now > MAX_TIMESTAMP_SKEW_MS) return { ok: false, reason: "future" }
  return { ok: true }
}

export interface WebhookVerification {
  ok: boolean
  status: number
  error?: string
}

/** Полная проверка входящего webhook: timestamp + HMAC. */
export function verifyWebhook(
  rawBody: string,
  headers: { timestamp?: string; signature?: string },
  now = Date.now(),
): WebhookVerification {
  const tsCheck = checkTimestamp(headers.timestamp, now)
  if (!tsCheck.ok) {
    return { ok: false, status: 401, error: `timestamp_${tsCheck.reason}` }
  }
  if (!headers.signature) {
    return { ok: false, status: 401, error: "signature_missing" }
  }
  if (!verifySignature(rawBody, headers.timestamp as string, headers.signature)) {
    return { ok: false, status: 401, error: "signature_invalid" }
  }
  return { ok: true, status: 200 }
}

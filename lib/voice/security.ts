// Криптографическая подпись и защита вебхуков.
// Заменяет прежний mockSignature (31-хеш) на реальный HMAC-SHA256 с timing-safe сравнением.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

/** Формат подписи: v1=<hex>. Версионирование позволяет менять алгоритм без ломки клиентов. */
export const SIGNATURE_VERSION = "v1"

/** Максимальный дрейф часов между отправителем и получателем. */
export const DEFAULT_TOLERANCE_SEC = 300

/** Максимальный размер тела вебхука — защита от memory-exhaustion. */
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024

export interface SignedPayload {
  signature: string
  timestamp: string
  body: string
}

/**
 * Канонический preimage: "<timestamp>.<raw body>".
 * Timestamp входит в подпись, поэтому его нельзя подменить при replay-атаке.
 */
export function buildSigningPayload(timestamp: string, rawBody: string): string {
  return `${timestamp}.${rawBody}`
}

/** Подписывает тело. Возвращает строку вида "v1=<hex>". */
export function signPayload(secret: string, timestamp: string, rawBody: string): string {
  if (!secret) throw new Error("Секрет подписи не задан")
  const mac = createHmac("sha256", secret).update(buildSigningPayload(timestamp, rawBody), "utf8").digest("hex")
  return `${SIGNATURE_VERSION}=${mac}`
}

/**
 * Сравнение фиксированного времени. Хеширует оба значения перед сравнением,
 * чтобы уравнять длину и не утечь её через исключение timingSafeEqual.
 */
export function safeCompare(a: string, b: string): boolean {
  const ha = createHmac("sha256", "cmp").update(a).digest()
  const hb = createHmac("sha256", "cmp").update(b).digest()
  return timingSafeEqual(ha, hb)
}

export type VerifyFailure =
  | "missing_signature"
  | "missing_timestamp"
  | "malformed_signature"
  | "unsupported_version"
  | "bad_timestamp"
  | "expired_timestamp"
  | "future_timestamp"
  | "body_too_large"
  | "no_secret_configured"
  | "signature_mismatch"

export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailure }

export interface VerifyOptions {
  secret: string | null | undefined
  signatureHeader: string | null | undefined
  timestampHeader: string | null | undefined
  rawBody: string
  toleranceSec?: number
  now?: number
  maxBodyBytes?: number
}

/**
 * Полная проверка входящего вебхука: размер тела, формат, срок жизни, затем подпись.
 * Порядок важен — дешёвые проверки идут раньше, чтобы не считать HMAC от мусора.
 */
export function verifyWebhook(options: VerifyOptions): VerifyResult {
  const {
    secret,
    signatureHeader,
    timestampHeader,
    rawBody,
    toleranceSec = DEFAULT_TOLERANCE_SEC,
    now = Date.now(),
    maxBodyBytes = MAX_WEBHOOK_BODY_BYTES,
  } = options

  if (Buffer.byteLength(rawBody, "utf8") > maxBodyBytes) return { ok: false, reason: "body_too_large" }
  if (!signatureHeader) return { ok: false, reason: "missing_signature" }
  if (!timestampHeader) return { ok: false, reason: "missing_timestamp" }

  const separator = signatureHeader.indexOf("=")
  if (separator <= 0) return { ok: false, reason: "malformed_signature" }
  const version = signatureHeader.slice(0, separator)
  const digest = signatureHeader.slice(separator + 1)
  if (version !== SIGNATURE_VERSION) return { ok: false, reason: "unsupported_version" }
  if (!/^[0-9a-f]{64}$/i.test(digest)) return { ok: false, reason: "malformed_signature" }

  const timestampMs = Number(timestampHeader)
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return { ok: false, reason: "bad_timestamp" }

  const driftSec = (now - timestampMs) / 1000
  if (driftSec > toleranceSec) return { ok: false, reason: "expired_timestamp" }
  if (driftSec < -toleranceSec) return { ok: false, reason: "future_timestamp" }

  // Проверку секрета делаем после валидации формата, чтобы отсутствие секрета
  // не маскировало явно некорректные запросы.
  if (!secret) return { ok: false, reason: "no_secret_configured" }

  const expected = signPayload(secret, timestampHeader, rawBody)
  if (!safeCompare(expected, signatureHeader)) return { ok: false, reason: "signature_mismatch" }

  return { ok: true }
}

/** Генерация секрета для новой компании. */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`
}

/**
 * Хеш секрета для хранения. Секрет в открытом виде показывается один раз при создании;
 * в БД лежит только SHA-256, поэтому дамп базы не даёт возможности подписывать события.
 */
export function hashSecret(secret: string): string {
  return createHmac("sha256", "voice-secret-hash").update(secret).digest("hex")
}

/** Проверяет, что предъявленный секрет соответствует сохранённому хешу. */
export function verifySecretAgainstHash(secret: string, hash: string): boolean {
  return safeCompare(hashSecret(secret), hash)
}

/** Первые 12 символов подписи — для аудита без раскрытия самой подписи. */
export function signaturePrefix(signature: string): string {
  return signature.slice(0, 12)
}

// Входящий вебхук провайдера телефонии.
//
// Отличия от прежней версии (которая принимала любой запрос):
//  - реальная подпись HMAC-SHA256 с timing-safe сравнением вместо mockSignature;
//  - защита от replay: timestamp в preimage + уникальный индекс в БД по event_id;
//  - идемпотентность в Postgres, а не в Set в памяти процесса;
//  - лимит размера тела и частоты запросов;
//  - ответы не раскрывают, какая именно проверка не прошла.
//
// Политика fail-closed: если секрет не настроен, запросы отклоняются.
// Отсутствие секрета не должно превращаться в «пропускаем всё».

import { NextResponse } from "next/server"
import { getCompany, registerInboundEvent, writeAudit } from "@/lib/voice/repo"
import { redactObject } from "@/lib/voice/redaction"
import { webhookLimiter } from "@/lib/voice/rate-limit"
import { MAX_WEBHOOK_BODY_BYTES, signaturePrefix, verifyWebhook } from "@/lib/voice/security"

export const runtime = "nodejs"
// Маршрут обязан читать сырое тело для HMAC, поэтому кеширование исключено.
export const dynamic = "force-dynamic"

const SIGNATURE_HEADER = "x-voice-signature"
const TIMESTAMP_HEADER = "x-voice-timestamp"
const COMPANY_HEADER = "x-voice-company"
const EVENT_HEADER = "x-voice-event-id"

/** Единый ответ на любую неудачу аутентификации — не даём атакующему оракул. */
function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 })
}

export async function POST(request: Request) {
  // Сырое тело обязательно до любого разбора: HMAC считается по байтам,
  // а JSON.parse + повторная сериализация меняют preimage.
  const rawBody = await request.text()

  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 })
  }

  const companyId = request.headers.get(COMPANY_HEADER)
  const signature = request.headers.get(SIGNATURE_HEADER)
  const timestamp = request.headers.get(TIMESTAMP_HEADER)
  const eventId = request.headers.get(EVENT_HEADER)

  if (!companyId || !eventId) return unauthorized()

  // Лимит частоты идёт до обращения к БД, чтобы флуд не создавал нагрузку на Postgres.
  const limit = webhookLimiter.check(companyId)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    )
  }

  const company = await getCompany(companyId)
  // Несуществующая компания и неверная подпись отвечают одинаково,
  // иначе перебор по заголовку раскрывал бы список арендаторов.
  if (!company || !company.active) return unauthorized()

  const secret = process.env.VOICE_PROVIDER_WEBHOOK_SECRET ?? null

  const verdict = verifyWebhook({
    secret,
    signatureHeader: signature,
    timestampHeader: timestamp,
    rawBody,
  })

  if (!verdict.ok) {
    await writeAudit({
      companyId,
      actor: "provider_webhook",
      action: "webhook.rejected",
      targetType: "event",
      targetId: eventId,
      outcome: "denied",
      // Причина уходит только в аудит, но не в тело ответа.
      detail: { reason: verdict.reason, signaturePrefix: signature ? signaturePrefix(signature) : "" },
    })
    return unauthorized()
  }

  // Подпись верна — только теперь разбираем JSON.
  let payload: unknown
  try {
    payload = rawBody.length > 0 ? JSON.parse(rawBody) : {}
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }

  // Идемпотентность в БД: уникальный индекс (company_id, source, event_id)
  // отсекает повтор даже при параллельных доставках и после рестарта процесса.
  // registerInboundEvent возвращает true только для впервые увиденного события.
  const isFresh = await registerInboundEvent({
    companyId,
    source: "provider",
    eventId,
    signaturePrefix: signature ? signaturePrefix(signature) : "",
  })

  if (!isFresh) {
    return NextResponse.json({ status: "duplicate_ignored", eventId })
  }

  await writeAudit({
    companyId,
    actor: "provider_webhook",
    action: "webhook.accepted",
    targetType: "event",
    targetId: eventId,
    outcome: "ok",
    detail: redactObject(payload) as Record<string, unknown>,
  })

  return NextResponse.json({ status: "accepted", eventId })
}

// Outbox исходящих событий с ретраями и dead-letter.
// Событие сначала попадает в БД, и только потом доставляется. Если доставка падает,
// событие не теряется: у него есть attempts, next_attempt_at и терминальный dead_letter.

import { and, asc, eq, inArray, lte, sql } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { db } from "@/lib/db"
import { voiceOutboxEvents } from "@/lib/db/schema"
import { redactObject, safeLog } from "./redaction"
import { signPayload } from "./security"

export type OutboxStatus = "pending" | "delivering" | "delivered" | "dead_letter"

export const EVENT_SCHEMA_VERSION = "1"

export interface EnqueueInput {
  companyId: string
  callId?: string | null
  type: string
  payload: Record<string, unknown>
  /** Ключ идемпотентности. Одинаковый ключ не создаёт второе событие. */
  idempotencyKey: string
  maxAttempts?: number
}

export interface OutboxEvent {
  eventId: string
  companyId: string
  callId: string | null
  type: string
  schemaVersion: string
  payload: Record<string, unknown>
  idempotencyKey: string
  status: OutboxStatus
  attempts: number
  maxAttempts: number
  nextAttemptAt: string
  lastError: string | null
}

/**
 * Экспоненциальная задержка с потолком и джиттером, чтобы ретраи не били залпом.
 * Джиттер применяется только вниз (80–100% от базы), поэтому результат никогда
 * не превышает capMs — иначе потолок перестаёт быть потолком.
 */
export function backoffMs(attempt: number, baseMs = 1000, capMs = 300_000): number {
  const raw = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1))
  const jittered = raw * (0.8 + 0.2 * Math.random())
  return Math.min(capMs, Math.max(0, Math.round(jittered)))
}

/**
 * Кладёт событие в outbox. Идемпотентно: при конфликте ключа возвращает существующее
 * событие, а не создаёт дубль.
 */
export async function enqueueEvent(input: EnqueueInput): Promise<{ eventId: string; created: boolean }> {
  const eventId = `evt_${randomUUID()}`
  const inserted = await db
    .insert(voiceOutboxEvents)
    .values({
      eventId,
      companyId: input.companyId,
      callId: input.callId ?? null,
      type: input.type,
      schemaVersion: EVENT_SCHEMA_VERSION,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      status: "pending",
      maxAttempts: input.maxAttempts ?? 6,
      nextAttemptAt: new Date(),
    })
    .onConflictDoNothing({ target: [voiceOutboxEvents.companyId, voiceOutboxEvents.idempotencyKey] })
    .returning({ eventId: voiceOutboxEvents.eventId })

  if (inserted.length > 0) return { eventId: inserted[0].eventId, created: true }

  const existing = await db
    .select({ eventId: voiceOutboxEvents.eventId })
    .from(voiceOutboxEvents)
    .where(
      and(
        eq(voiceOutboxEvents.companyId, input.companyId),
        eq(voiceOutboxEvents.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1)

  return { eventId: existing[0]?.eventId ?? eventId, created: false }
}

/**
 * Атомарно захватывает события, готовые к доставке, переводя их в `delivering`.
 *
 * Простой SELECT здесь недопустим: два параллельных воркера (или наложившиеся
 * запуски планировщика) выбрали бы одни и те же строки и доставили событие в
 * Control Center дважды. `FOR UPDATE SKIP LOCKED` — стандартный приём Postgres
 * для очереди: каждая строка достаётся ровно одному воркеру, остальные её
 * пропускают, а не ждут.
 */
export async function claimDueEvents(limit = 20): Promise<OutboxEvent[]> {
  const claimed = await db.execute(sql`
    UPDATE ${voiceOutboxEvents}
       SET status = 'delivering'
     WHERE ${voiceOutboxEvents.eventId} IN (
       SELECT ${voiceOutboxEvents.eventId}
         FROM ${voiceOutboxEvents}
        WHERE ${voiceOutboxEvents.status} = 'pending'
          AND ${voiceOutboxEvents.nextAttemptAt} <= now()
        ORDER BY ${voiceOutboxEvents.nextAttemptAt} ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING *
  `)

  const rows = claimed.rows as unknown as Array<{
    event_id: string
    company_id: string
    call_id: string | null
    type: string
    schema_version: string
    payload: Record<string, unknown>
    idempotency_key: string
    status: string
    attempts: number
    max_attempts: number
    next_attempt_at: Date
    last_error: string | null
  }>

  return rows.map((r) => ({
    eventId: r.event_id,
    companyId: r.company_id,
    callId: r.call_id,
    type: r.type,
    schemaVersion: r.schema_version,
    payload: r.payload,
    idempotencyKey: r.idempotency_key,
    status: r.status as OutboxStatus,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    nextAttemptAt: new Date(r.next_attempt_at).toISOString(),
    lastError: r.last_error,
  }))
}

/**
 * Возвращает в очередь захваты, брошенные упавшим воркером.
 *
 * Если процесс умер между захватом и результатом, событие осталось в
 * `delivering` и без этого прохода не доставилось бы никогда. Вызывать перед
 * каждым проходом доставки.
 */
export async function reclaimStaleEvents(staleAfterMs = 120_000): Promise<number> {
  const cutoff = new Date(Date.now() - staleAfterMs)
  const result = await db
    .update(voiceOutboxEvents)
    .set({ status: "pending" })
    .where(and(eq(voiceOutboxEvents.status, "delivering"), lte(voiceOutboxEvents.nextAttemptAt, cutoff)))
    .returning({ eventId: voiceOutboxEvents.eventId })
  if (result.length > 0) safeLog("outbox.reclaimed_stale", { count: result.length })
  return result.length
}

/** Возвращает захваченное событие в очередь, если доставку начать не удалось. */
export async function releaseEvent(eventId: string): Promise<void> {
  await db
    .update(voiceOutboxEvents)
    .set({ status: "pending" })
    .where(and(eq(voiceOutboxEvents.eventId, eventId), eq(voiceOutboxEvents.status, "delivering")))
}

export async function markDelivered(eventId: string): Promise<void> {
  await db
    .update(voiceOutboxEvents)
    .set({ status: "delivered", deliveredAt: new Date(), lastError: null })
    .where(eq(voiceOutboxEvents.eventId, eventId))
}

/**
 * Фиксирует неудачу. Пока попытки не исчерпаны — планирует следующий заход.
 * Исчерпаны — переводит в dead_letter, откуда событие можно поднять вручную.
 */
export async function markFailed(eventId: string, error: string): Promise<{ deadLettered: boolean }> {
  const rows = await db
    .select({ attempts: voiceOutboxEvents.attempts, maxAttempts: voiceOutboxEvents.maxAttempts })
    .from(voiceOutboxEvents)
    .where(eq(voiceOutboxEvents.eventId, eventId))
    .limit(1)
  if (rows.length === 0) return { deadLettered: false }

  const attempts = rows[0].attempts + 1
  const exhausted = attempts >= rows[0].maxAttempts
  const truncatedError = error.slice(0, 500)

  await db
    .update(voiceOutboxEvents)
    .set({
      attempts,
      status: exhausted ? "dead_letter" : "pending",
      lastError: truncatedError,
      nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
      deadLetteredAt: exhausted ? new Date() : null,
    })
    .where(eq(voiceOutboxEvents.eventId, eventId))

  return { deadLettered: exhausted }
}

export interface DeliveryTarget {
  url: string
  secret: string
}

export interface DeliveryResult {
  eventId: string
  ok: boolean
  status?: number
  error?: string
  deadLettered?: boolean
}

/**
 * Доставляет одно событие подписанным POST-запросом.
 * Подпись считается от того же тела, что уходит в сеть, иначе получатель её не сойдётся.
 */
export async function deliverEvent(
  event: OutboxEvent,
  target: DeliveryTarget,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<DeliveryResult> {
  const timestamp = String(Date.now())
  const body = JSON.stringify({
    eventId: event.eventId,
    type: event.type,
    schemaVersion: event.schemaVersion,
    companyId: event.companyId,
    callId: event.callId,
    idempotencyKey: event.idempotencyKey,
    timestamp,
    payload: event.payload,
  })
  const signature = signPayload(target.secret, timestamp, body)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(target.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-voice-signature": signature,
        "x-voice-timestamp": timestamp,
        "x-voice-event-id": event.eventId,
        "x-voice-idempotency-key": event.idempotencyKey,
      },
      body,
      signal: controller.signal,
    })

    if (response.ok) {
      await markDelivered(event.eventId)
      return { eventId: event.eventId, ok: true, status: response.status }
    }

    // 4xx (кроме 408/429) — постоянная ошибка: ретраи не помогут, сразу в dead-letter.
    const permanent = response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)
    if (permanent) {
      await db
        .update(voiceOutboxEvents)
        .set({
          status: "dead_letter",
          attempts: event.attempts + 1,
          lastError: `HTTP ${response.status} (постоянная ошибка)`,
          deadLetteredAt: new Date(),
        })
        .where(eq(voiceOutboxEvents.eventId, event.eventId))
      return { eventId: event.eventId, ok: false, status: response.status, deadLettered: true }
    }

    const { deadLettered } = await markFailed(event.eventId, `HTTP ${response.status}`)
    return { eventId: event.eventId, ok: false, status: response.status, deadLettered }
  } catch (error) {
    const message = error instanceof Error ? error.message : "неизвестная ошибка сети"
    const { deadLettered } = await markFailed(event.eventId, message)
    return { eventId: event.eventId, ok: false, error: message, deadLettered }
  } finally {
    clearTimeout(timer)
  }
}

/** Один проход воркера доставки. Вызывается из cron-роута. */
export async function drainOutbox(
  resolveTarget: (companyId: string) => Promise<DeliveryTarget | null>,
  limit = 20,
  fetchImpl: typeof fetch = fetch,
): Promise<{ processed: number; delivered: number; failed: number; skipped: number; deadLettered: number }> {
  const events = await claimDueEvents(limit)
  let delivered = 0
  let failed = 0
  let skipped = 0
  let deadLettered = 0

  for (const event of events) {
    const target = await resolveTarget(event.companyId)
    if (!target) {
      // Некуда доставлять — не тратим попытку, но обязательно снимаем захват:
      // claimDueEvents выбирает только 'pending', поэтому событие, оставленное
      // в 'delivering', не вернулось бы в очередь никогда.
      await db
        .update(voiceOutboxEvents)
        .set({ status: "pending", nextAttemptAt: new Date(Date.now() + 60_000), lastError: "webhook не настроен" })
        .where(eq(voiceOutboxEvents.eventId, event.eventId))
      skipped++
      continue
    }

    // deliverEvent сам не бросает, но resolveTarget/сеть могут дать неожиданное
    // исключение — без catch событие осталось бы захваченным навсегда.
    try {
      const result = await deliverEvent(event, target, fetchImpl)
      if (result.ok) delivered++
      else {
        failed++
        if (result.deadLettered) deadLettered++
        safeLog("outbox.delivery_failed", {
          eventId: result.eventId,
          type: event.type,
          error: result.error ?? result.status,
          deadLettered: result.deadLettered ?? false,
        })
      }
    } catch (error) {
      failed++
      const outcome = await markFailed(event.eventId, error instanceof Error ? error.message : "unknown")
      if (outcome.deadLettered) deadLettered++
      safeLog("outbox.delivery_threw", { eventId: event.eventId, type: event.type })
    }
  }

  return { processed: events.length, delivered, failed, skipped, deadLettered }
}

export interface OutboxStats {
  pending: number
  delivered: number
  deadLetter: number
  oldestPendingAt: string | null
}

export async function outboxStats(companyId: string): Promise<OutboxStats> {
  const rows = await db
    .select({
      status: voiceOutboxEvents.status,
      count: sql<number>`count(*)::int`,
      oldest: sql<Date | null>`min(${voiceOutboxEvents.createdAt})`,
    })
    .from(voiceOutboxEvents)
    .where(eq(voiceOutboxEvents.companyId, companyId))
    .groupBy(voiceOutboxEvents.status)

  const stats: OutboxStats = { pending: 0, delivered: 0, deadLetter: 0, oldestPendingAt: null }
  for (const row of rows) {
    if (row.status === "pending") {
      stats.pending = row.count
      stats.oldestPendingAt = row.oldest ? new Date(row.oldest).toISOString() : null
    } else if (row.status === "delivered") stats.delivered = row.count
    else if (row.status === "dead_letter") stats.deadLetter = row.count
  }
  return stats
}

/** Возвращает события из dead-letter в очередь — операция для оператора Control Center. */
export async function replayDeadLetter(companyId: string, eventIds?: string[]): Promise<number> {
  // inArray параметризует значения — подстановка строк в SQL недопустима.
  const condition = eventIds?.length
    ? and(
        eq(voiceOutboxEvents.companyId, companyId),
        eq(voiceOutboxEvents.status, "dead_letter"),
        inArray(voiceOutboxEvents.eventId, eventIds),
      )
    : and(eq(voiceOutboxEvents.companyId, companyId), eq(voiceOutboxEvents.status, "dead_letter"))

  const result = await db
    .update(voiceOutboxEvents)
    .set({ status: "pending", attempts: 0, nextAttemptAt: new Date(), deadLetteredAt: null, lastError: null })
    .where(condition)
    .returning({ eventId: voiceOutboxEvents.eventId })

  safeLog("outbox.replay", { companyId, count: result.length, payload: redactObject({ eventIds }) })
  return result.length
}

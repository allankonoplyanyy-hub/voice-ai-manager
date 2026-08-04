// Персистентность прогонов звонков в Postgres.
//
// Заменяет прежний in-memory store: артефакты звонка (звонок, переходы,
// транскрипт, лид, запись, follow-up) пишутся в БД и переживают рестарт.
// Исходящие события кладутся в outbox — подпись ставится при доставке
// секретом конкретного получателя, а не при создании события.

import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { db, pool } from "@/lib/db"
import {
  voiceBookings,
  voiceCallTransitions,
  voiceCalls,
  voiceCompanies,
  voiceFollowUps,
  voiceLeads,
  voiceOutboxEvents,
  voiceTranscripts,
} from "@/lib/db/schema"
import { runScenario, type ScenarioRunResult } from "./engine"
import { enqueueEvent } from "./outbox"
import { DEMO_SCENARIOS } from "./scenarios"
import type { Booking, CallOutcome, CallState, FollowUp, Lead, VoiceCall, VoiceEvent } from "./types"

/* ------------------------------- Компании -------------------------------- */

/** Демо-арендаторы. Ключи совпадают с companyId в сценариях. */
export const COMPANY_REGISTRY: { companyId: string; name: string; industry: string }[] = [
  { companyId: "school-astana", name: "Частная школа «Астана»", industry: "Образование" },
  { companyId: "clinic-almaty", name: "Клиника «Алматы Мед»", industry: "Медицина" },
  { companyId: "beauty-astana", name: "Салон красоты «Астана»", industry: "Красота" },
  { companyId: "auto-almaty", name: "Автосервис «Алматы»", industry: "Авто" },
  { companyId: "realty-astana", name: "Агентство «Астана Недвижимость»", industry: "Недвижимость" },
  { companyId: "resto-almaty", name: "Ресторан «Алматы»", industry: "HoReCa" },
  { companyId: "shop-online", name: "Интернет-магазин", industry: "E-commerce" },
]

/* ------------------------ Маппинг даты бронирования ----------------------- */

// Схема хранит момент времени (startsAt/endsAt), а домен — строки «дата» и
// «время». Кодируем строки как UTC, чтобы round-trip был точным и не зависел
// от таймзоны процесса: запись 15:00 обязана читаться как 15:00.
function toInstant(date: string, time: string): Date {
  return new Date(`${date}T${time}:00.000Z`)
}

function fromInstant(instant: Date): { date: string; time: string } {
  const iso = instant.toISOString()
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) }
}

const BOOKING_DURATION_MS = 3600_000

/* ------------------------------ Запись прогона ---------------------------- */

/**
 * Пишет результат прогона сценария целиком.
 *
 * Всё, кроме outbox, укладывается в одну транзакцию: половинчатый звонок без
 * транскрипта хуже отсутствующего. События публикуются после коммита — иначе
 * доставка могла бы обогнать данные, на которые ссылается.
 */
export async function persistRun(result: ScenarioRunResult): Promise<void> {
  const { call, lead, booking, followUps, events } = result

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(voiceCalls)
      .values({
        callId: call.callId,
        companyId: call.companyId,
        providerCallId: call.providerCallId,
        provider: "mock",
        mode: "demo",
        direction: call.direction,
        clientName: call.clientName,
        clientPhone: call.clientPhone,
        state: call.state,
        outcome: call.outcome,
        intent: call.intent,
        consentGiven: call.consentGiven,
        summary: call.summary,
        leadId: lead?.id ?? null,
        bookingId: booking?.id ?? null,
        handoff: call.handoff as unknown as Record<string, unknown> | null,
        errors: call.errors as unknown as Record<string, unknown>[],
        unansweredQuestions: call.unansweredQuestions,
        durationSec: call.durationSec,
        costTenge: call.costTenge,
        scenarioId: call.scenarioId,
        correlationId: call.callId,
        startedAt: new Date(call.startedAt),
        endedAt: new Date(new Date(call.startedAt).getTime() + call.durationSec * 1000),
      })
      .onConflictDoNothing({ target: voiceCalls.callId })
      .returning({ callId: voiceCalls.callId })

    // Повторный прогон с тем же callId (например, повтор сида) не должен
    // плодить дубли дочерних строк — выходим, не тронув остальное.
    if (inserted.length === 0) return

    if (call.transitions.length > 0) {
      await tx.insert(voiceCallTransitions).values(
        call.transitions.map((t) => ({
          callId: call.callId,
          companyId: call.companyId,
          fromState: t.from,
          toState: t.to,
          note: t.note ?? null,
          at: new Date(t.at),
        })),
      )
    }

    if (call.transcript.length > 0) {
      await tx.insert(voiceTranscripts).values(
        call.transcript.map((t) => ({
          callId: call.callId,
          companyId: call.companyId,
          role: t.role,
          text: t.text,
          state: t.state,
          at: new Date(t.at),
        })),
      )
    }

    if (lead) {
      await tx
        .insert(voiceLeads)
        .values({
          id: lead.id,
          companyId: lead.companyId,
          callId: lead.callId,
          name: lead.name,
          phone: lead.phone,
          interest: lead.interest,
          niche: lead.niche,
          service: lead.service,
          source: lead.source,
          intent: lead.intent,
          score: lead.score,
          temperature: lead.temperature,
          comment: lead.comment,
          managerSummary: lead.managerSummary,
          nextBestAction: lead.nextBestAction,
          crmStatus: lead.crmStatus,
          crmExternalId: lead.crmExternalId,
          createdAt: new Date(lead.createdAt),
        })
        .onConflictDoNothing({ target: voiceLeads.id })
    }

    if (booking) {
      const startsAt = toInstant(booking.date, booking.time)
      await tx
        .insert(voiceBookings)
        .values({
          id: booking.id,
          companyId: booking.companyId,
          callId: booking.callId,
          leadId: booking.leadId,
          service: booking.service,
          startsAt,
          endsAt: new Date(startsAt.getTime() + BOOKING_DURATION_MS),
          status: booking.status,
          calendarStatus: booking.calendarStatus,
          idempotencyKey: `${booking.callId}:booking`,
          createdAt: new Date(booking.createdAt),
        })
        .onConflictDoNothing({ target: voiceBookings.id })
    }

    if (followUps.length > 0) {
      await tx
        .insert(voiceFollowUps)
        .values(
          followUps.map((f) => ({
            id: f.id,
            companyId: f.companyId,
            callId: f.callId,
            channel: f.channel,
            recipient: f.recipient,
            text: f.text,
            status: f.status,
            reason: f.reason,
            errorReason: f.errorReason,
            createdAt: new Date(f.createdAt),
          })),
        )
        .onConflictDoNothing({ target: voiceFollowUps.id })
    }
  })

  for (const event of events) {
    await enqueueEvent({
      companyId: event.companyId,
      callId: event.callId,
      type: event.type,
      payload: event.payload,
      idempotencyKey: event.idempotencyKey,
    })
  }
}

/* --------------------------------- Сиды ----------------------------------- */

// Детерминированное расписание demo-истории: сценарий → смещение в днях.
const SEED_SCHEDULE: { scenarioId: string; daysAgo: number; hour: number }[] = [
  { scenarioId: "school-enroll", daysAgo: 0, hour: 9 },
  { scenarioId: "clinic-appointment", daysAgo: 0, hour: 10 },
  { scenarioId: "angry-customer", daysAgo: 0, hour: 11 },
  { scenarioId: "shop-order-status", daysAgo: 0, hour: 13 },
  { scenarioId: "beauty-booking", daysAgo: 1, hour: 12 },
  { scenarioId: "auto-diagnostic", daysAgo: 1, hour: 15 },
  { scenarioId: "realty-buy", daysAgo: 2, hour: 10 },
  { scenarioId: "complex-question", daysAgo: 2, hour: 16 },
  { scenarioId: "resto-banquet", daysAgo: 3, hour: 18 },
  { scenarioId: "no-slots", daysAgo: 3, hour: 11 },
  { scenarioId: "ask-manager", daysAgo: 4, hour: 14 },
  { scenarioId: "crm-failure", daysAgo: 5, hour: 9 },
  { scenarioId: "calendar-failure", daysAgo: 6, hour: 10 },
  { scenarioId: "school-enroll", daysAgo: 8, hour: 10 },
  { scenarioId: "clinic-appointment", daysAgo: 10, hour: 11 },
  { scenarioId: "beauty-booking", daysAgo: 12, hour: 14 },
  { scenarioId: "auto-diagnostic", daysAgo: 14, hour: 9 },
  { scenarioId: "realty-buy", daysAgo: 16, hour: 15 },
  { scenarioId: "resto-banquet", daysAgo: 18, hour: 19 },
  { scenarioId: "shop-order-status", daysAgo: 20, hour: 12 },
  { scenarioId: "angry-customer", daysAgo: 22, hour: 16 },
  { scenarioId: "no-slots", daysAgo: 25, hour: 13 },
  { scenarioId: "clinic-appointment", daysAgo: 28, hour: 10 },
]

const SEED_LOCK_KEY = 918_273_645

export async function ensureCompanies(): Promise<void> {
  await db
    .insert(voiceCompanies)
    .values(
      COMPANY_REGISTRY.map((c) => ({
        companyId: c.companyId,
        name: c.name,
        industry: c.industry,
        mode: "demo" as const,
      })),
    )
    .onConflictDoNothing({ target: voiceCompanies.companyId })
}

/**
 * Разово наполняет БД демо-историей.
 *
 * Advisory-блокировка нужна из-за конкурентного старта: несколько запросов
 * (или инстансов) вошли бы в сид одновременно. Блокировка транзакционная,
 * поэтому снимается сама даже при ошибке.
 */
async function callCount(): Promise<number> {
  const rows = await db.select({ n: sql<number>`count(*)::int` }).from(voiceCalls)
  return rows[0]?.n ?? 0
}

export async function ensureSeeded(): Promise<{ seeded: boolean }> {
  await ensureCompanies()
  if ((await callCount()) > 0) return { seeded: false }

  // Сессионная блокировка на выделенном соединении: persistRun открывает свои
  // транзакции, поэтому транзакционный lock здесь не подошёл бы.
  const client = await pool.connect()
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SEED_LOCK_KEY])
    // Повторная проверка под блокировкой: пока мы её ждали, сид мог выполнить
    // другой процесс.
    if ((await callCount()) > 0) return { seeded: false }

    const now = new Date()
    for (const [i, item] of SEED_SCHEDULE.entries()) {
      const scenario = DEMO_SCENARIOS.find((s) => s.id === item.scenarioId)
      if (!scenario) continue
      const startedAt = new Date(now)
      startedAt.setDate(startedAt.getDate() - item.daysAgo)
      startedAt.setHours(item.hour, (i * 7) % 60, 0, 0)
      await persistRun(runScenario(scenario, startedAt, `seed-${i}`))
    }
    return { seeded: true }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [SEED_LOCK_KEY])
    client.release()
  }
}

/* --------------------------------- Чтение --------------------------------- */

function rowToCall(
  row: typeof voiceCalls.$inferSelect,
  transitions: (typeof voiceCallTransitions.$inferSelect)[] = [],
  transcript: (typeof voiceTranscripts.$inferSelect)[] = [],
  followUpIds: string[] = [],
): VoiceCall {
  return {
    callId: row.callId,
    companyId: row.companyId,
    providerCallId: row.providerCallId,
    clientName: row.clientName,
    clientPhone: row.clientPhone,
    direction: row.direction as VoiceCall["direction"],
    startedAt: row.startedAt.toISOString(),
    durationSec: row.durationSec,
    state: row.state as CallState,
    outcome: (row.outcome ?? "info_only") as CallOutcome,
    intent: row.intent,
    consentGiven: row.consentGiven,
    transcript: transcript.map((t) => ({
      role: t.role as VoiceCall["transcript"][number]["role"],
      text: t.text,
      at: t.at.toISOString(),
      state: t.state as CallState,
    })),
    transitions: transitions.map((t) => ({
      from: t.fromState as CallState,
      to: t.toState as CallState,
      at: t.at.toISOString(),
      note: t.note ?? undefined,
    })),
    summary: row.summary,
    leadId: row.leadId,
    bookingId: row.bookingId,
    handoff: (row.handoff ?? null) as VoiceCall["handoff"],
    errors: (row.errors ?? []) as unknown as VoiceCall["errors"],
    unansweredQuestions: row.unansweredQuestions ?? [],
    costTenge: row.costTenge,
    scenarioId: row.scenarioId ?? "",
    followUpIds,
  }
}

function rowToLead(row: typeof voiceLeads.$inferSelect): Lead {
  return {
    id: row.id,
    companyId: row.companyId,
    callId: row.callId,
    name: row.name,
    phone: row.phone,
    interest: row.interest,
    niche: row.niche,
    service: row.service,
    source: row.source as Lead["source"],
    intent: row.intent,
    score: row.score,
    temperature: row.temperature as Lead["temperature"],
    comment: row.comment,
    managerSummary: row.managerSummary,
    nextBestAction: row.nextBestAction,
    crmStatus: row.crmStatus as Lead["crmStatus"],
    crmExternalId: row.crmExternalId,
    createdAt: row.createdAt.toISOString(),
  }
}

function rowToBooking(row: typeof voiceBookings.$inferSelect): Booking {
  const { date, time } = fromInstant(row.startsAt)
  return {
    id: row.id,
    companyId: row.companyId,
    callId: row.callId,
    leadId: row.leadId,
    service: row.service,
    date,
    time,
    status: row.status as Booking["status"],
    calendarStatus: row.calendarStatus as Booking["calendarStatus"],
    createdAt: row.createdAt.toISOString(),
  }
}

function rowToFollowUp(row: typeof voiceFollowUps.$inferSelect): FollowUp {
  return {
    id: row.id,
    companyId: row.companyId,
    callId: row.callId,
    channel: row.channel as FollowUp["channel"],
    recipient: row.recipient,
    text: row.text,
    status: row.status as FollowUp["status"],
    reason: row.reason,
    errorReason: row.errorReason,
    createdAt: row.createdAt.toISOString(),
  }
}

/** Список звонков всех арендаторов — только для внутренних demo-экранов. */
export async function listAllCalls(limit = 200): Promise<VoiceCall[]> {
  const rows = await db.select().from(voiceCalls).orderBy(desc(voiceCalls.startedAt)).limit(limit)
  return rows.map((r) => rowToCall(r))
}

export async function listCallsByCompany(companyId: string, limit = 200): Promise<VoiceCall[]> {
  const rows = await db
    .select()
    .from(voiceCalls)
    .where(eq(voiceCalls.companyId, companyId))
    .orderBy(desc(voiceCalls.startedAt))
    .limit(limit)
  return rows.map((r) => rowToCall(r))
}

/** Звонок целиком: с переходами, транскриптом и связанными артефактами. */
export async function getCallDetail(callId: string): Promise<{
  call: VoiceCall
  lead: Lead | null
  booking: Booking | null
  followUps: FollowUp[]
  events: VoiceEvent[]
} | null> {
  const rows = await db.select().from(voiceCalls).where(eq(voiceCalls.callId, callId)).limit(1)
  const row = rows[0]
  if (!row) return null

  const [transitions, transcript, followUpRows, eventRows] = await Promise.all([
    db
      .select()
      .from(voiceCallTransitions)
      .where(and(eq(voiceCallTransitions.callId, callId), eq(voiceCallTransitions.companyId, row.companyId)))
      .orderBy(voiceCallTransitions.id),
    db
      .select()
      .from(voiceTranscripts)
      .where(and(eq(voiceTranscripts.callId, callId), eq(voiceTranscripts.companyId, row.companyId)))
      .orderBy(voiceTranscripts.id),
    db
      .select()
      .from(voiceFollowUps)
      .where(and(eq(voiceFollowUps.callId, callId), eq(voiceFollowUps.companyId, row.companyId)))
      .orderBy(voiceFollowUps.createdAt),
    db
      .select()
      .from(voiceOutboxEvents)
      .where(and(eq(voiceOutboxEvents.callId, callId), eq(voiceOutboxEvents.companyId, row.companyId)))
      .orderBy(voiceOutboxEvents.createdAt),
  ])

  const lead = row.leadId
    ? await db
        .select()
        .from(voiceLeads)
        .where(and(eq(voiceLeads.id, row.leadId), eq(voiceLeads.companyId, row.companyId)))
        .limit(1)
        .then((r) => (r[0] ? rowToLead(r[0]) : null))
    : null

  const booking = row.bookingId
    ? await db
        .select()
        .from(voiceBookings)
        .where(and(eq(voiceBookings.id, row.bookingId), eq(voiceBookings.companyId, row.companyId)))
        .limit(1)
        .then((r) => (r[0] ? rowToBooking(r[0]) : null))
    : null

  return {
    call: rowToCall(
      row,
      transitions,
      transcript,
      followUpRows.map((f) => f.id),
    ),
    lead,
    booking,
    followUps: followUpRows.map(rowToFollowUp),
    events: eventRows.map((e) => ({
      eventId: e.eventId,
      companyId: e.companyId,
      callId: e.callId ?? callId,
      type: e.type as VoiceEvent["type"],
      timestamp: e.createdAt.toISOString(),
      idempotencyKey: e.idempotencyKey,
      payload: e.payload,
    })),
  }
}

export async function listAllLeads(limit = 200): Promise<Lead[]> {
  const rows = await db.select().from(voiceLeads).orderBy(desc(voiceLeads.createdAt)).limit(limit)
  return rows.map(rowToLead)
}

export async function listLeadsByCompany(companyId: string, limit = 200): Promise<Lead[]> {
  const rows = await db
    .select()
    .from(voiceLeads)
    .where(eq(voiceLeads.companyId, companyId))
    .orderBy(desc(voiceLeads.createdAt))
    .limit(limit)
  return rows.map(rowToLead)
}

export async function listAllBookings(limit = 200): Promise<Booking[]> {
  const rows = await db.select().from(voiceBookings).orderBy(desc(voiceBookings.createdAt)).limit(limit)
  return rows.map(rowToBooking)
}

export async function listAllFollowUps(limit = 200): Promise<FollowUp[]> {
  const rows = await db.select().from(voiceFollowUps).orderBy(desc(voiceFollowUps.createdAt)).limit(limit)
  return rows.map(rowToFollowUp)
}

/**
 * Краткие сведения о звонках одним запросом.
 *
 * Нужно экранам, которые показывают клиента рядом со связанной сущностью
 * (календарь, лиды): иначе на каждую строку уходил бы отдельный SELECT.
 */
export async function callSummaries(
  callIds: string[],
): Promise<Map<string, { clientName: string | null; clientPhone: string }>> {
  if (callIds.length === 0) return new Map()
  const rows = await db
    .select({
      callId: voiceCalls.callId,
      clientName: voiceCalls.clientName,
      clientPhone: voiceCalls.clientPhone,
    })
    .from(voiceCalls)
    .where(inArray(voiceCalls.callId, callIds))
  return new Map(rows.map((r) => [r.callId, { clientName: r.clientName, clientPhone: r.clientPhone }]))
}

/** Follow-up для набора звонков одним запросом — чтобы не плодить N+1. */
export async function followUpsForCalls(callIds: string[]): Promise<FollowUp[]> {
  if (callIds.length === 0) return []
  const rows = await db.select().from(voiceFollowUps).where(inArray(voiceFollowUps.callId, callIds))
  return rows.map(rowToFollowUp)
}

/** Счётчики для экрана состояния системы. */
export async function storeCounters(): Promise<{
  calls: number
  leads: number
  bookings: number
  followUps: number
  events: number
  inboundEvents: number
}> {
  const [calls, leads, bookings, followUps, events] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(voiceCalls),
    db.select({ n: sql<number>`count(*)::int` }).from(voiceLeads),
    db.select({ n: sql<number>`count(*)::int` }).from(voiceBookings),
    db.select({ n: sql<number>`count(*)::int` }).from(voiceFollowUps),
    db.select({ n: sql<number>`count(*)::int` }).from(voiceOutboxEvents),
  ])
  return {
    calls: calls[0]?.n ?? 0,
    leads: leads[0]?.n ?? 0,
    bookings: bookings[0]?.n ?? 0,
    followUps: followUps[0]?.n ?? 0,
    events: events[0]?.n ?? 0,
    inboundEvents: 0,
  }
}

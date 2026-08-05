// Репозитории с обязательным company-scoping.
// RLS в Neon нет, поэтому изоляция арендаторов держится на том, что КАЖДЫЙ запрос
// содержит eq(table.companyId, companyId). Функции без companyId здесь не появляются.

import { and, desc, eq, gte, sql } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { db } from "@/lib/db"
import {
  voiceAuditLog,
  voiceCallTransitions,
  voiceCalls,
  voiceCompanies,
  voiceInboundEvents,
  voiceKnowledgeVersions,
  voiceLeads,
  voiceTranscripts,
  voiceTurnMetrics,
} from "@/lib/db/schema"
import type { TurnMetrics } from "./latency"
import { type OperatingMode, isOperatingMode } from "./modes"

import { isUniqueViolation } from "@/lib/db/errors"

/** Ошибка обращения к чужому арендатору. Отдаётся как 404, чтобы не подтверждать существование. */
export class TenantScopeError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} не найден в этой компании`)
    this.name = "TenantScopeError"
  }
}

export interface CompanyRow {
  companyId: string
  name: string
  mode: OperatingMode
  timezone: string
  defaultLanguage: string
  fallbackLanguage: string
  criticalKeywords: string[]
  webhookUrl: string | null
  webhookSecretHash: string | null
  testNumberAllowlist: string[]
  maxCallDurationSec: number
  maxCallCostTenge: number
  dailyBudgetTenge: number
  bookingProvider: string
  active: boolean
}

export async function getCompany(companyId: string): Promise<CompanyRow | null> {
  const rows = await db.select().from(voiceCompanies).where(eq(voiceCompanies.companyId, companyId)).limit(1)
  if (rows.length === 0) return null
  const r = rows[0]
  return {
    companyId: r.companyId,
    name: r.name,
    mode: isOperatingMode(r.mode) ? r.mode : "demo",
    timezone: r.timezone,
    defaultLanguage: r.defaultLanguage,
    fallbackLanguage: r.fallbackLanguage,
    criticalKeywords: r.criticalKeywords,
    webhookUrl: r.webhookUrl,
    webhookSecretHash: r.webhookSecretHash,
    testNumberAllowlist: r.testNumberAllowlist,
    maxCallDurationSec: r.maxCallDurationSec,
    maxCallCostTenge: r.maxCallCostTenge,
    dailyBudgetTenge: r.dailyBudgetTenge,
    bookingProvider: r.bookingProvider,
    active: r.active,
  }
}

export async function requireCompany(companyId: string): Promise<CompanyRow> {
  const company = await getCompany(companyId)
  if (!company) throw new TenantScopeError("Компания", companyId)
  return company
}

export async function listCompanies(): Promise<CompanyRow[]> {
  const rows = await db.select().from(voiceCompanies).orderBy(voiceCompanies.name)
  return rows.map((r) => ({
    companyId: r.companyId,
    name: r.name,
    mode: isOperatingMode(r.mode) ? r.mode : "demo",
    timezone: r.timezone,
    defaultLanguage: r.defaultLanguage,
    fallbackLanguage: r.fallbackLanguage,
    criticalKeywords: r.criticalKeywords,
    webhookUrl: r.webhookUrl,
    webhookSecretHash: r.webhookSecretHash,
    testNumberAllowlist: r.testNumberAllowlist,
    maxCallDurationSec: r.maxCallDurationSec,
    maxCallCostTenge: r.maxCallCostTenge,
    dailyBudgetTenge: r.dailyBudgetTenge,
    bookingProvider: r.bookingProvider,
    active: r.active,
  }))
}

export async function upsertCompany(input: {
  companyId: string
  name: string
  industry?: string
  phoneNumber?: string
  mode?: OperatingMode
  greeting?: string
  systemPrompt?: string
  criticalKeywords?: string[]
  webhookUrl?: string | null
  webhookSecretHash?: string | null
  testNumberAllowlist?: string[]
}): Promise<void> {
  await db
    .insert(voiceCompanies)
    .values({
      companyId: input.companyId,
      name: input.name,
      industry: input.industry ?? "",
      phoneNumber: input.phoneNumber ?? "",
      mode: input.mode ?? "demo",
      greeting: input.greeting ?? "",
      systemPrompt: input.systemPrompt ?? "",
      criticalKeywords: input.criticalKeywords ?? [],
      webhookUrl: input.webhookUrl ?? null,
      webhookSecretHash: input.webhookSecretHash ?? null,
      webhookSecretSetAt: input.webhookSecretHash ? new Date() : null,
      testNumberAllowlist: input.testNumberAllowlist ?? [],
    })
    .onConflictDoUpdate({
      target: voiceCompanies.companyId,
      set: {
        name: input.name,
        mode: input.mode ?? "demo",
        criticalKeywords: input.criticalKeywords ?? [],
        webhookUrl: input.webhookUrl ?? null,
        updatedAt: new Date(),
      },
    })
}

/* ---------------------------------- Звонки --------------------------------- */

export interface CreateCallInput {
  companyId: string
  providerCallId: string
  provider: string
  mode: OperatingMode
  clientPhone: string
  clientName?: string | null
  language: string
  correlationId: string
  scenarioId?: string | null
}

export async function createCall(input: CreateCallInput): Promise<string> {
  const callId = `call_${randomUUID()}`
  await db.insert(voiceCalls).values({
    callId,
    companyId: input.companyId,
    providerCallId: input.providerCallId,
    provider: input.provider,
    mode: input.mode,
    clientPhone: input.clientPhone,
    clientName: input.clientName ?? null,
    language: input.language,
    state: "received",
    correlationId: input.correlationId,
    scenarioId: input.scenarioId ?? null,
  })
  return callId
}

export async function getCall(companyId: string, callId: string) {
  const rows = await db
    .select()
    .from(voiceCalls)
    .where(and(eq(voiceCalls.companyId, companyId), eq(voiceCalls.callId, callId)))
    .limit(1)
  return rows[0] ?? null
}

export async function requireCall(companyId: string, callId: string) {
  const call = await getCall(companyId, callId)
  if (!call) throw new TenantScopeError("Звонок", callId)
  return call
}

export async function listCalls(companyId: string, limit = 50) {
  return db
    .select()
    .from(voiceCalls)
    .where(eq(voiceCalls.companyId, companyId))
    .orderBy(desc(voiceCalls.startedAt))
    .limit(Math.min(limit, 200))
}

/**
 * Записывает переход состояния и обновляет звонок одной транзакцией.
 * Условие на from_state делает переход compare-and-set: параллельный вебхук
 * не сможет применить переход из уже изменившегося состояния.
 */
export async function applyTransition(params: {
  companyId: string
  callId: string
  fromState: string
  toState: string
  note?: string
  patch?: Partial<{
    outcome: string | null
    intent: string | null
    consentGiven: boolean
    summary: string
    leadId: string | null
    bookingId: string | null
    durationSec: number
    costTenge: number
    endedAt: Date | null
  }>
}): Promise<{ applied: boolean; currentState: string }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ state: voiceCalls.state })
      .from(voiceCalls)
      .where(and(eq(voiceCalls.companyId, params.companyId), eq(voiceCalls.callId, params.callId)))
      .limit(1)
      .for("update")

    if (rows.length === 0) throw new TenantScopeError("Звонок", params.callId)
    const current = rows[0].state
    if (current !== params.fromState) return { applied: false, currentState: current }

    await tx
      .update(voiceCalls)
      .set({ state: params.toState, updatedAt: new Date(), ...(params.patch ?? {}) })
      .where(and(eq(voiceCalls.companyId, params.companyId), eq(voiceCalls.callId, params.callId)))

    await tx.insert(voiceCallTransitions).values({
      callId: params.callId,
      companyId: params.companyId,
      fromState: params.fromState,
      toState: params.toState,
      note: params.note ?? null,
    })

    return { applied: true, currentState: params.toState }
  })
}

export async function listTransitions(companyId: string, callId: string) {
  return db
    .select()
    .from(voiceCallTransitions)
    .where(and(eq(voiceCallTransitions.companyId, companyId), eq(voiceCallTransitions.callId, callId)))
    .orderBy(voiceCallTransitions.id)
}

export async function appendTranscript(params: {
  companyId: string
  callId: string
  role: string
  text: string
  state: string
  isFinal?: boolean
  language?: string
}): Promise<void> {
  await db.insert(voiceTranscripts).values({
    companyId: params.companyId,
    callId: params.callId,
    role: params.role,
    text: params.text,
    state: params.state,
    isFinal: params.isFinal ?? true,
    language: params.language ?? "ru",
  })
}

export async function listTranscript(companyId: string, callId: string) {
  return db
    .select()
    .from(voiceTranscripts)
    .where(and(eq(voiceTranscripts.companyId, companyId), eq(voiceTranscripts.callId, callId)))
    .orderBy(voiceTranscripts.id)
}

/* ----------------------------------- Лиды ---------------------------------- */

export async function createLead(input: {
  companyId: string
  callId: string
  name: string
  phone: string
  interest: string
  service: string
  intent: string
  score: number
  temperature: string
  comment: string
  managerSummary: string
  nextBestAction: string
}): Promise<string> {
  const id = `lead_${randomUUID()}`
  await db.insert(voiceLeads).values({ id, ...input })
  return id
}

export async function listLeads(companyId: string, limit = 50) {
  return db
    .select()
    .from(voiceLeads)
    .where(eq(voiceLeads.companyId, companyId))
    .orderBy(desc(voiceLeads.createdAt))
    .limit(Math.min(limit, 200))
}

/* ------------------------- Идемпотентность вебхуков ------------------------ */

/**
 * Регистрирует входящее событие. Возвращает false, если событие уже обрабатывалось.
 * Это durable-защита от replay: уникальный индекс живёт в БД, а не в памяти процесса,
 * поэтому рестарт или второй инстанс не откроют окно для повторной обработки.
 */
export async function registerInboundEvent(params: {
  companyId: string
  source: string
  eventId: string
  signaturePrefix: string
}): Promise<boolean> {
  try {
    const inserted = await db
      .insert(voiceInboundEvents)
      .values(params)
      .onConflictDoNothing({
        target: [voiceInboundEvents.companyId, voiceInboundEvents.source, voiceInboundEvents.eventId],
      })
      .returning({ id: voiceInboundEvents.id })
    return inserted.length > 0
  } catch (error) {
    if (isUniqueViolation(error)) return false
    throw error
  }
}

/* ----------------------------------- Аудит --------------------------------- */

export async function writeAudit(params: {
  companyId: string
  actor?: string
  action: string
  targetType?: string
  targetId?: string
  outcome?: string
  detail?: Record<string, unknown>
  correlationId?: string
}): Promise<void> {
  await db.insert(voiceAuditLog).values({
    companyId: params.companyId,
    actor: params.actor ?? "system",
    action: params.action,
    targetType: params.targetType ?? "",
    targetId: params.targetId ?? "",
    outcome: params.outcome ?? "ok",
    detail: params.detail ?? {},
    correlationId: params.correlationId ?? "",
  })
}

export async function listAudit(companyId: string, limit = 100) {
  return db
    .select()
    .from(voiceAuditLog)
    .where(eq(voiceAuditLog.companyId, companyId))
    .orderBy(desc(voiceAuditLog.at))
    .limit(Math.min(limit, 500))
}

/* --------------------------------- Метрики --------------------------------- */

export async function recordTurnMetrics(metrics: TurnMetrics): Promise<void> {
  await db.insert(voiceTurnMetrics).values({
    companyId: metrics.companyId,
    callId: metrics.callId,
    turnIndex: metrics.turnIndex,
    mode: metrics.mode,
    vadEndMs: metrics.stages.vad_end ?? null,
    sttPartialMs: metrics.stages.stt_partial ?? null,
    sttFinalMs: metrics.stages.stt_final ?? null,
    knowledgeMs: metrics.stages.knowledge ?? null,
    llmFirstTokenMs: metrics.stages.llm_first_token ?? null,
    llmCompleteMs: metrics.stages.llm_complete ?? null,
    ttsFirstAudioMs: metrics.stages.tts_first_audio ?? null,
    firstAudioDeliveredMs: metrics.stages.first_audio_delivered ?? null,
    fullTurnMs: metrics.fullTurnMs ?? null,
    bookingProviderMs: metrics.stages.booking_provider ?? null,
    handoffMs: metrics.stages.handoff ?? null,
    interrupted: metrics.interrupted,
    interruptionHandled: metrics.interruptionHandled,
    emptyTranscript: metrics.emptyTranscript,
    fallbackUsed: metrics.fallbackUsed,
  })
}

export async function turnMetricsSince(companyId: string, sinceIso: string) {
  return db
    .select()
    .from(voiceTurnMetrics)
    .where(and(eq(voiceTurnMetrics.companyId, companyId), gte(voiceTurnMetrics.at, new Date(sinceIso))))
    .orderBy(desc(voiceTurnMetrics.at))
    .limit(5000)
}

/* ------------------------------- База знаний ------------------------------- */

export async function publishedKnowledgeVersion(companyId: string) {
  const rows = await db
    .select()
    .from(voiceKnowledgeVersions)
    .where(and(eq(voiceKnowledgeVersions.companyId, companyId), eq(voiceKnowledgeVersions.status, "published")))
    .orderBy(desc(voiceKnowledgeVersions.version))
    .limit(1)
  return rows[0] ?? null
}

export async function countCallsToday(companyId: string): Promise<{ calls: number; costTenge: number }> {
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)
  const rows = await db
    .select({
      calls: sql<number>`count(*)::int`,
      cost: sql<number>`coalesce(sum(${voiceCalls.costTenge}), 0)::int`,
    })
    .from(voiceCalls)
    .where(and(eq(voiceCalls.companyId, companyId), gte(voiceCalls.startedAt, startOfDay)))
  return { calls: rows[0]?.calls ?? 0, costTenge: rows[0]?.cost ?? 0 }
}

import { runScenario } from "./engine"
import { DEMO_SCENARIOS } from "./scenarios"
import type { Booking, FollowUp, Lead, VoiceCall, VoiceEvent } from "./types"

// In-memory demo store. Данные существуют в памяти процесса
// и пересоздаются при перезапуске (demo-режим по требованию проекта).

export interface VoiceStore {
  calls: Map<string, VoiceCall>
  leads: Map<string, Lead>
  bookings: Map<string, Booking>
  followUps: Map<string, FollowUp>
  events: VoiceEvent[]
  processedWebhookKeys: Set<string> // идемпотентность webhook
  seededAt: string
}

declare global {
  // eslint-disable-next-line no-var
  var __voiceStore: VoiceStore | undefined
}

// Детерминированное расписание demo-истории: сценарий → смещения в днях от «сегодня».
// Метрики рассчитываются из этих звонков, никаких случайных чисел.
const SEED_SCHEDULE: { scenarioId: string; daysAgo: number; hour: number }[] = [
  // сегодня
  { scenarioId: "school-enroll", daysAgo: 0, hour: 9 },
  { scenarioId: "clinic-appointment", daysAgo: 0, hour: 10 },
  { scenarioId: "angry-customer", daysAgo: 0, hour: 11 },
  { scenarioId: "shop-order-status", daysAgo: 0, hour: 13 },
  // последние 7 дней
  { scenarioId: "beauty-booking", daysAgo: 1, hour: 12 },
  { scenarioId: "auto-diagnostic", daysAgo: 1, hour: 15 },
  { scenarioId: "realty-buy", daysAgo: 2, hour: 10 },
  { scenarioId: "complex-question", daysAgo: 2, hour: 16 },
  { scenarioId: "resto-banquet", daysAgo: 3, hour: 18 },
  { scenarioId: "no-slots", daysAgo: 3, hour: 11 },
  { scenarioId: "ask-manager", daysAgo: 4, hour: 14 },
  { scenarioId: "crm-failure", daysAgo: 5, hour: 9 },
  { scenarioId: "calendar-failure", daysAgo: 6, hour: 10 },
  { scenarioId: "manager-unavailable", daysAgo: 6, hour: 17 },
  // 8–30 дней
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

function seedStore(): VoiceStore {
  const store: VoiceStore = {
    calls: new Map(),
    leads: new Map(),
    bookings: new Map(),
    followUps: new Map(),
    events: [],
    processedWebhookKeys: new Set(),
    seededAt: new Date().toISOString(),
  }

  const now = new Date()
  for (const [i, item] of SEED_SCHEDULE.entries()) {
    const scenario = DEMO_SCENARIOS.find((s) => s.id === item.scenarioId)
    if (!scenario) continue
    const startedAt = new Date(now)
    startedAt.setDate(startedAt.getDate() - item.daysAgo)
    startedAt.setHours(item.hour, (i * 7) % 60, 0, 0)
    const result = runScenario(scenario, startedAt, `seed-${i}`)
    persistRun(store, result)
  }

  return store
}

export function persistRun(
  store: VoiceStore,
  result: ReturnType<typeof runScenario>,
): void {
  store.calls.set(result.call.callId, result.call)
  if (result.lead) store.leads.set(result.lead.id, result.lead)
  if (result.booking) store.bookings.set(result.booking.id, result.booking)
  for (const fu of result.followUps) store.followUps.set(fu.id, fu)
  store.events.push(...result.events)
}

export function getStore(): VoiceStore {
  if (!globalThis.__voiceStore) {
    globalThis.__voiceStore = seedStore()
  }
  return globalThis.__voiceStore
}

// ----- Company-scoped выборки (изоляция тенантов) -----

export function getCallsByCompany(companyId: string): VoiceCall[] {
  return [...getStore().calls.values()]
    .filter((c) => c.companyId === companyId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

export function getAllCalls(): VoiceCall[] {
  return [...getStore().calls.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

export function getCall(callId: string): VoiceCall | undefined {
  return getStore().calls.get(callId)
}

export function getLead(leadId: string): Lead | undefined {
  return getStore().leads.get(leadId)
}

export function getBooking(bookingId: string): Booking | undefined {
  return getStore().bookings.get(bookingId)
}

export function getFollowUpsByCall(callId: string): FollowUp[] {
  return [...getStore().followUps.values()].filter((f) => f.callId === callId)
}

export function getEventsByCall(callId: string): VoiceEvent[] {
  return getStore().events.filter((e) => e.callId === callId)
}

export function getLeadsByCompany(companyId: string): Lead[] {
  return [...getStore().leads.values()]
    .filter((l) => l.companyId === companyId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getAllLeads(): Lead[] {
  return [...getStore().leads.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getAllBookings(): Booking[] {
  return [...getStore().bookings.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getAllFollowUps(): FollowUp[] {
  return [...getStore().followUps.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// Идемпотентная обработка webhook: повторный ключ не создаёт дубль.
export function processWebhook(idempotencyKey: string): { duplicate: boolean } {
  const store = getStore()
  if (store.processedWebhookKeys.has(idempotencyKey)) {
    return { duplicate: true }
  }
  store.processedWebhookKeys.add(idempotencyKey)
  return { duplicate: false }
}

import { signPayload } from "./security"
import { assertTransition } from "./state-machine"
import type {
  Booking,
  CallOutcome,
  CallState,
  DemoScenario,
  FollowUp,
  Lead,
  VoiceCall,
  VoiceEvent,
} from "./types"

// Детерминированный движок: «проигрывает» demo-сценарий и создаёт
// полный набор артефактов звонка. Никаких внешних вызовов и случайных данных.

export interface ScenarioRunResult {
  call: VoiceCall
  lead: Lead | null
  booking: Booking | null
  followUps: FollowUp[]
  events: VoiceEvent[]
}

const AVG_STEP_SEC = 14

function intentFromScenario(s: DemoScenario): string {
  const map: Record<string, string> = {
    "school-enroll": "Запись в 1 класс",
    "clinic-appointment": "Запись к кардиологу",
    "beauty-booking": "Запись на окрашивание",
    "auto-diagnostic": "Диагностика подвески",
    "realty-buy": "Покупка 2-комнатной квартиры",
    "resto-banquet": "Бронь столика (юбилей)",
    "shop-order-status": "Статус заказа / возврат",
    "angry-customer": "Претензия: повреждённый товар",
    "complex-question": "Медицинский вопрос (вне базы)",
    "ask-manager": "Оценка коммерческой недвижимости",
    "no-slots": "Маникюр (лист ожидания)",
    "crm-failure": "Замена масла",
    "calendar-failure": "Запись на УЗИ",
    "manager-unavailable": "Банкет: свадьба на 120 гостей",
  }
  return map[s.id] ?? s.title
}

function scoreForScenario(s: DemoScenario): { score: number; temperature: Lead["temperature"] } {
  if (s.id === "realty-buy") return { score: 85, temperature: "hot" }
  if (s.createsBooking) return { score: 75, temperature: "hot" }
  if (s.createsHandoff) return { score: 60, temperature: "warm" }
  if (s.createsLead) return { score: 55, temperature: "warm" }
  return { score: 30, temperature: "cold" }
}

export interface RunOptions {
  /** Cost guard: лимит стоимости звонка в тенге. При превышении звонок завершается cost_limit_reached. */
  maxCallCostTenge?: number
}

export function runScenario(
  scenario: DemoScenario,
  startedAt: Date,
  runId: string,
  options: RunOptions = {},
): ScenarioRunResult {
  const callId = `call-${scenario.id}-${runId}`
  const providerCallId = `prov-${runId}`
  const events: VoiceEvent[] = []
  const followUps: FollowUp[] = []
  let lead: Lead | null = null
  let booking: Booking | null = null

  const call: VoiceCall = {
    callId,
    companyId: scenario.companyId,
    providerCallId,
    clientName: scenario.clientName,
    clientPhone: scenario.clientPhone,
    direction: "inbound",
    startedAt: startedAt.toISOString(),
    durationSec: scenario.steps.length * AVG_STEP_SEC,
    state: "received",
    outcome: scenario.expectedOutcome,
    intent: null,
    consentGiven: false,
    transcript: [],
    transitions: [],
    summary: "",
    leadId: null,
    bookingId: null,
    handoff: null,
    followUpIds: [],
    errors: [],
    unansweredQuestions: [],
    costTenge: Math.round(scenario.steps.length * AVG_STEP_SEC * 0.35),
    scenarioId: scenario.id,
  }

  let currentState: CallState = "received"
  let stepTime = startedAt.getTime()

  const pushEvent = (type: VoiceEvent["type"], payload: Record<string, unknown>) => {
    const timestamp = new Date(stepTime).toISOString()
    const idempotencyKey = `${callId}-${type}-${events.length}`
    events.push({
      eventId: `evt-${runId}-${events.length}`,
      companyId: scenario.companyId,
      callId,
      type,
      timestamp,
      idempotencyKey,
      payload,
      // HMAC-SHA256 по контракту voice-ai.v1 (см. lib/voice/contract.ts)
      signature: signPayload(JSON.stringify(payload), timestamp),
    })
  }

  let accumulatedCost = 0

  for (const [i, step] of scenario.steps.entries()) {
    stepTime += AVG_STEP_SEC * 1000
    accumulatedCost += Math.round(AVG_STEP_SEC * 0.35)

    // Cost guard: превышение лимита → терминальное состояние, диалог прерывается
    if (options.maxCallCostTenge !== undefined && accumulatedCost > options.maxCallCostTenge && currentState !== "cost_limit_reached") {
      assertTransition(currentState, "cost_limit_reached")
      call.transitions.push({
        from: currentState,
        to: "cost_limit_reached",
        at: new Date(stepTime).toISOString(),
        note: `Cost guard: превышен лимит ${options.maxCallCostTenge} тг`,
      })
      currentState = "cost_limit_reached"
      call.outcome = "failed"
      call.costTenge = accumulatedCost
      call.durationSec = (i + 1) * AVG_STEP_SEC
      pushEvent("voice.call.failed", { reason: "cost_limit_reached", costTenge: accumulatedCost })
      break
    }

    // Переход состояния
    if (step.toState && step.toState !== currentState) {
      assertTransition(currentState, step.toState)
      call.transitions.push({
        from: currentState,
        to: step.toState,
        at: new Date(stepTime).toISOString(),
        note: step.role === "system" ? step.text : undefined,
      })
      currentState = step.toState
    }

    // Транскрипт
    call.transcript.push({
      role: step.role,
      text: step.text,
      at: new Date(stepTime).toISOString(),
      state: currentState,
    })

    // Ошибки (soft-fail)
    if (step.error) {
      call.errors.push({
        at: new Date(stepTime).toISOString(),
        system: step.error,
        message: step.text,
        recovered: true,
      })
    }

    // События
    if (step.event) {
      if (step.event === "voice.consent.received") call.consentGiven = true
      if (step.event === "voice.intent.detected") call.intent = intentFromScenario(scenario)

      if (step.event === "voice.lead.created" && scenario.createsLead && !lead) {
        const { score, temperature } = scoreForScenario(scenario)
        lead = {
          id: `lead-${runId}`,
          companyId: scenario.companyId,
          callId,
          name: scenario.clientName ?? "Не представился",
          phone: scenario.clientPhone,
          interest: intentFromScenario(scenario),
          niche: scenario.companyId,
          service: intentFromScenario(scenario),
          source: "voice_ai",
          intent: intentFromScenario(scenario),
          score,
          temperature,
          comment: scenario.context,
          managerSummary: `${scenario.title}. ${scenario.context}`,
          nextBestAction: scenario.createsBooking
            ? "Подтвердить визит за день до записи"
            : scenario.createsHandoff
              ? "Менеджеру: связаться в течение 15 минут"
              : "Отправить материалы и перезвонить в течение дня",
          crmStatus: scenario.id === "crm-failure" ? "pending_retry" : "synced_mock",
          crmExternalId: scenario.id === "crm-failure" ? null : `crm-ext-${runId}`,
          createdAt: new Date(stepTime).toISOString(),
        }
        call.leadId = lead.id
      }

      if (step.event === "voice.booking.created" && scenario.createsBooking && !booking) {
        booking = {
          id: `bk-${runId}`,
          companyId: scenario.companyId,
          callId,
          leadId: lead?.id ?? null,
          service: intentFromScenario(scenario),
          date: new Date(stepTime + 86400_000).toISOString().slice(0, 10),
          time: scenario.id === "crm-failure" ? "09:00" : "15:00",
          status: "confirmed",
          calendarStatus: "synced_mock",
          createdAt: new Date(stepTime).toISOString(),
        }
        call.bookingId = booking.id
      }

      if (step.event === "voice.followup.created") {
        const fu = scenario.followUps[followUps.length]
        if (fu) {
          const followUp: FollowUp = {
            id: `fu-${runId}-${followUps.length}`,
            companyId: scenario.companyId,
            callId,
            channel: fu.channel,
            recipient: scenario.clientPhone,
            text: fu.reason,
            status: "sent_mock",
            reason: fu.reason,
            errorReason: null,
            createdAt: new Date(stepTime).toISOString(),
          }
          followUps.push(followUp)
          call.followUpIds.push(followUp.id)
        }
      }

      if (step.event === "voice.handoff.requested" && scenario.createsHandoff) {
        call.handoff = {
          callId,
          companyId: scenario.companyId,
          reason: scenario.createsHandoff,
          reasonText: step.text,
          targetManager: scenario.companyId === "realty-astana" ? "Данияр (старший брокер)" : "Дежурный менеджер",
          at: new Date(stepTime).toISOString(),
        }
      }

      pushEvent(step.event, { step: i, text: step.text.slice(0, 120) })
    }

    // Вопросы без ответа
    if (scenario.id === "complex-question" && step.role === "client" && i === 3) {
      call.unansweredQuestions.push(step.text)
    }
  }

  call.state = currentState
  call.summary = buildSummary(scenario, call.outcome, lead, booking)

  return { call, lead, booking, followUps, events }
}

function buildSummary(
  scenario: DemoScenario,
  outcome: CallOutcome,
  lead: Lead | null,
  booking: Booking | null,
): string {
  const parts: string[] = [scenario.context]
  if (lead) parts.push(`Лид: ${lead.name}, ${lead.phone}, score ${lead.score}.`)
  if (booking) parts.push(`Запись: ${booking.date} в ${booking.time} (${booking.service}).`)
  if (scenario.createsHandoff) parts.push("Звонок передан менеджеру с полным резюме.")
  const outcomeLabel: Record<CallOutcome, string> = {
    lead_created: "Итог: создан лид.",
    booking_created: "Итог: создана запись.",
    handoff: "Итог: передан менеджеру.",
    info_only: "Итог: консультация без лида.",
    no_answer: "Итог: нет ответа.",
    abandoned: "Итог: звонок прерван.",
    rejected: "Итог: клиент отказался от обработки.",
    failed: "Итог: сбой.",
  }
  parts.push(outcomeLabel[outcome])
  return parts.join(" ")
}

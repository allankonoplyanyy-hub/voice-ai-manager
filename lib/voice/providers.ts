import type {
  AdapterStatus,
  FollowUpChannel,
  HandoffReason,
  KnowledgeDocument,
  Lead,
} from "./types"

// Provider-интерфейсы. Каждый внешний контур системы (телефония, STT, TTS,
// LLM, знания, CRM, календарь, сообщения, handoff) описан интерфейсом.
// Demo-режим использует ТОЛЬКО mock-реализации — ни одного сетевого запроса.
// Live-реализации подключаются через env; без настройки провайдер
// возвращает { ok: false, status: "not_configured" } и система не падает (soft-fail).

export interface ProviderResult<T> {
  ok: boolean
  status: AdapterStatus | "ok"
  provider: string
  data: T | null
  /** Признак деградации: операция не выполнена, но система продолжила работу. */
  softFailed?: boolean
  error?: string
}

// ---------- Интерфейсы ----------

export interface TelephonyProvider {
  readonly name: string
  answerCall(providerCallId: string): ProviderResult<{ accepted: boolean }>
  hangup(providerCallId: string): ProviderResult<{ done: boolean }>
}

export interface SttProvider {
  readonly name: string
  transcribe(audioRef: string): ProviderResult<{ text: string }>
}

export interface TtsProvider {
  readonly name: string
  synthesize(text: string): ProviderResult<{ audioRef: string }>
}

export interface LlmProvider {
  readonly name: string
  decide(context: { state: string; lastClientText: string }): ProviderResult<{ reply: string }>
}

export interface KnowledgeProvider {
  readonly name: string
  search(companyId: string, query: string, docs: KnowledgeDocument[]): ProviderResult<{ matches: KnowledgeDocument[] }>
}

export interface CrmProvider {
  readonly name: string
  createLead(lead: Lead): ProviderResult<{ externalId: string }>
}

export interface CalendarProvider {
  readonly name: string
  findSlots(companyId: string, service: string): ProviderResult<{ slots: string[] }>
  book(companyId: string, slot: string): ProviderResult<{ bookingRef: string }>
}

export interface MessagingProvider {
  readonly name: string
  send(channel: FollowUpChannel, recipient: string, text: string): ProviderResult<{ messageRef: string }>
}

export interface HandoffProvider {
  readonly name: string
  transfer(callId: string, reason: HandoffReason, summary: string): ProviderResult<{ manager: string; accepted: boolean }>
}

// ---------- Mock-реализации (0 сетевых запросов) ----------

function okResult<T>(provider: string, data: T): ProviderResult<T> {
  return { ok: true, status: "ok", provider, data }
}

function softFail<T>(provider: string, error: string): ProviderResult<T> {
  return { ok: false, status: "error", provider, data: null, softFailed: true, error }
}

export const mockTelephony: TelephonyProvider = {
  name: "Mock Telephony",
  answerCall: () => okResult("Mock Telephony", { accepted: true }),
  hangup: () => okResult("Mock Telephony", { done: true }),
}

export const mockStt: SttProvider = {
  name: "Mock STT",
  transcribe: (audioRef) => okResult("Mock STT", { text: `[scripted:${audioRef}]` }),
}

export const mockTts: TtsProvider = {
  name: "Mock TTS",
  synthesize: (text) => okResult("Mock TTS", { audioRef: `mock-audio-${text.length}` }),
}

export const mockLlm: LlmProvider = {
  name: "Scripted Orchestrator",
  decide: (ctx) => okResult("Scripted Orchestrator", { reply: `[scripted reply for state ${ctx.state}]` }),
}

export const mockKnowledge: KnowledgeProvider = {
  name: "In-memory Knowledge",
  search: (companyId, query, docs) => {
    const q = query.toLowerCase()
    const matches = docs.filter(
      (d) => d.companyId === companyId && (d.title.toLowerCase().includes(q) || d.content.toLowerCase().includes(q)),
    )
    return okResult("In-memory Knowledge", { matches })
  },
}

/** Mock CRM с переключаемым сбоем — для сценария crm-failure и тестов. */
export function createMockCrm(options?: { failNext?: boolean }): CrmProvider & { failNext: boolean } {
  return {
    name: "Mock CRM",
    failNext: options?.failNext ?? false,
    createLead(lead) {
      if (this.failNext) {
        this.failNext = false
        return softFail("Mock CRM", "timeout: CRM недоступна (эмуляция)")
      }
      return okResult("Mock CRM", { externalId: `crm-ext-${lead.id}` })
    },
  }
}

/** Mock Calendar с переключаемым сбоем — для сценария calendar-failure и тестов. */
export function createMockCalendar(options?: { failNext?: boolean }): CalendarProvider & { failNext: boolean } {
  return {
    name: "Mock Calendar",
    failNext: options?.failNext ?? false,
    findSlots(_companyId, _service) {
      if (this.failNext) {
        return softFail("Mock Calendar", "connection refused: календарь недоступен (эмуляция)")
      }
      return okResult("Mock Calendar", { slots: ["10:00", "14:30", "16:00"] })
    },
    book(_companyId, slot) {
      if (this.failNext) {
        this.failNext = false
        return softFail("Mock Calendar", "connection refused: календарь недоступен (эмуляция)")
      }
      return okResult("Mock Calendar", { bookingRef: `mock-bk-${slot}` })
    },
  }
}

export const mockMessaging: MessagingProvider = {
  name: "Mock Messaging",
  send: (channel, recipient) => okResult("Mock Messaging", { messageRef: `mock-msg-${channel}-${recipient.slice(-4)}` }),
}

/** Mock Handoff с переключаемой недоступностью менеджера. */
export function createMockHandoff(options?: { managerUnavailable?: boolean }): HandoffProvider & { managerUnavailable: boolean } {
  return {
    name: "Mock Transfer",
    managerUnavailable: options?.managerUnavailable ?? false,
    transfer(_callId, _reason, _summary) {
      if (this.managerUnavailable) {
        return softFail("Mock Transfer", "менеджер недоступен: все линии заняты (эмуляция)")
      }
      return okResult("Mock Transfer", { manager: "Дежурный менеджер", accepted: true })
    },
  }
}

// ---------- Live-провайдеры (не активированы) ----------

/** Любой live-провайдер без настройки: единый безопасный ответ, без исключений. */
export function notConfigured<T>(provider: string): ProviderResult<T> {
  return { ok: false, status: "not_configured", provider, data: null, softFailed: true, error: "provider_not_configured" }
}

export interface ProviderRegistry {
  telephony: TelephonyProvider
  stt: SttProvider
  tts: TtsProvider
  llm: LlmProvider
  knowledge: KnowledgeProvider
  crm: CrmProvider
  calendar: CalendarProvider
  messaging: MessagingProvider
  handoff: HandoffProvider
}

/** Demo-набор: все провайдеры mock, сеть не используется. */
export function createDemoRegistry(): ProviderRegistry {
  return {
    telephony: mockTelephony,
    stt: mockStt,
    tts: mockTts,
    llm: mockLlm,
    knowledge: mockKnowledge,
    crm: createMockCrm(),
    calendar: createMockCalendar(),
    messaging: mockMessaging,
    handoff: createMockHandoff(),
  }
}

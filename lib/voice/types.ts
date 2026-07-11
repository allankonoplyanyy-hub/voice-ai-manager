// AAA Voice AI Manager — доменные типы
// Все объекты являются company-scoped (multi-tenant): обязательное поле companyId.

export type CallState =
  | "received"
  | "greeting"
  | "consent"
  | "identifying_intent"
  | "consulting"
  | "qualifying"
  | "lead_capture"
  | "booking"
  | "follow_up"
  | "completed"
  // альтернативные состояния
  | "manager_handoff"
  | "no_answer"
  | "abandoned"
  | "rejected"
  | "provider_failed"
  | "cost_limit_reached"

export type CallOutcome =
  | "lead_created"
  | "booking_created"
  | "handoff"
  | "info_only"
  | "no_answer"
  | "abandoned"
  | "rejected"
  | "failed"

export type LeadTemperature = "hot" | "warm" | "cold"

export type HandoffReason =
  | "customer_request"
  | "aggression"
  | "out_of_knowledge"
  | "vip_client"
  | "complaint"
  | "high_value_deal"
  | "recognition_failure"
  | "critical_keyword"

export type FollowUpChannel = "sms" | "telegram" | "whatsapp" | "email"

export type FollowUpStatus = "queued" | "sent_mock" | "failed"

export type AdapterStatus = "mock" | "not_configured" | "error"

export interface StateTransition {
  from: CallState
  to: CallState
  at: string // ISO
  note?: string
}

export interface TranscriptEntry {
  role: "client" | "assistant" | "system"
  text: string
  at: string
  state: CallState
}

export interface VoiceTenant {
  companyId: string
  name: string
  industry: string
  phoneNumber: string
  language: "ru" | "kk" | "en"
  greeting: string
  systemPrompt: string
  criticalKeywords: string[]
  maxCallDurationSec: number
  maxCallCostTenge: number
  active: boolean
  createdAt: string
}

export interface KnowledgeDocument {
  id: string
  companyId: string
  category:
    | "about"
    | "services"
    | "pricing"
    | "schedule"
    | "address"
    | "staff"
    | "faq"
    | "rules"
    | "objections"
    | "forbidden"
    | "handoff_rules"
  title: string
  content: string
  updatedAt: string
}

export interface Lead {
  id: string
  companyId: string
  callId: string
  name: string
  phone: string
  interest: string
  niche: string
  service: string
  source: "voice_ai"
  intent: string
  score: number // 0-100
  temperature: LeadTemperature
  comment: string
  managerSummary: string
  nextBestAction: string
  crmStatus: "synced_mock" | "pending_retry" | "failed_soft"
  crmExternalId: string | null
  createdAt: string
}

export interface Booking {
  id: string
  companyId: string
  callId: string
  leadId: string | null
  service: string
  date: string
  time: string
  status: "confirmed" | "pending_manager" | "cancelled"
  calendarStatus: "synced_mock" | "pending_retry" | "failed_soft"
  createdAt: string
}

export interface FollowUp {
  id: string
  companyId: string
  callId: string
  channel: FollowUpChannel
  recipient: string
  text: string
  status: FollowUpStatus
  reason: string
  errorReason: string | null
  createdAt: string
}

export interface Handoff {
  callId: string
  companyId: string
  reason: HandoffReason
  reasonText: string
  targetManager: string
  at: string
}

export interface VoiceEvent {
  eventId: string
  companyId: string
  callId: string
  type:
    | "voice.call.started"
    | "voice.consent.received"
    | "voice.intent.detected"
    | "voice.lead.created"
    | "voice.booking.created"
    | "voice.handoff.requested"
    | "voice.followup.created"
    | "voice.call.completed"
    | "voice.call.failed"
    | "voice.usage.updated"
  timestamp: string
  idempotencyKey: string
  payload: Record<string, unknown>
  signature: string // mock HMAC
}

export interface CallError {
  at: string
  system: "crm" | "calendar" | "messaging" | "stt" | "provider"
  message: string
  recovered: boolean
}

export interface VoiceCall {
  callId: string
  companyId: string
  providerCallId: string
  clientName: string | null
  clientPhone: string
  direction: "inbound"
  startedAt: string
  durationSec: number
  state: CallState
  outcome: CallOutcome
  intent: string | null
  consentGiven: boolean
  transcript: TranscriptEntry[]
  transitions: StateTransition[]
  summary: string
  leadId: string | null
  bookingId: string | null
  handoff: Handoff | null
  followUpIds: string[]
  errors: CallError[]
  unansweredQuestions: string[]
  costTenge: number
  scenarioId: string | null
}

export interface DemoScenarioStep {
  role: "client" | "assistant" | "system"
  text: string
  toState?: CallState
  event?: VoiceEvent["type"]
  error?: CallError["system"]
  delayMs?: number
}

export interface DemoScenario {
  id: string
  companyId: string
  title: string
  context: string
  clientName: string | null
  clientPhone: string
  steps: DemoScenarioStep[]
  expectedOutcome: CallOutcome
  createsLead: boolean
  createsBooking: boolean
  createsHandoff: HandoffReason | null
  followUps: { channel: FollowUpChannel; reason: string }[]
}

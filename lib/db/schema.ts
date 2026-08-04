// Drizzle-схема, отражающая таблицы, созданные в Neon.
// Все таблицы company-scoped: company_id обязателен в каждом запросе.
// FK намеренно не используются — изоляция обеспечивается явным scoping в репозиториях.

import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

// --- Аутентификация (Better Auth) ---
// Имена колонок в camelCase — так их ожидает Better Auth по умолчанию,
// переименовывать нельзя, иначе вход перестанет работать.

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
})

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

// Связь сотрудника с компанией. Именно она определяет, чьи данные человек
// вправе видеть: companyId для запросов берётся отсюда, а не из URL.
export const voiceCompanyMembers = pgTable(
  "voice_company_members",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    companyId: text("company_id").notNull(),
    role: text("role").notNull().default("operator"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("voice_company_members_user_company_unique").on(t.userId, t.companyId)],
)

export const voiceCompanies = pgTable("voice_companies", {
  companyId: text("company_id").primaryKey(),
  name: text("name").notNull(),
  industry: text("industry").notNull().default(""),
  phoneNumber: text("phone_number").notNull().default(""),
  timezone: text("timezone").notNull().default("Asia/Almaty"),
  defaultLanguage: text("default_language").notNull().default("ru"),
  fallbackLanguage: text("fallback_language").notNull().default("ru"),
  mode: text("mode").notNull().default("demo"),
  greeting: text("greeting").notNull().default(""),
  farewell: text("farewell").notNull().default(""),
  systemPrompt: text("system_prompt").notNull().default(""),
  criticalKeywords: jsonb("critical_keywords").$type<string[]>().notNull().default([]),
  voiceConfig: jsonb("voice_config").$type<Record<string, unknown>>().notNull().default({}),
  bookingProvider: text("booking_provider").notNull().default("mock"),
  recordingEnabled: boolean("recording_enabled").notNull().default(false),
  recordingRetentionDays: integer("recording_retention_days").notNull().default(0),
  maxCallDurationSec: integer("max_call_duration_sec").notNull().default(600),
  maxCallCostTenge: integer("max_call_cost_tenge").notNull().default(500),
  dailyBudgetTenge: integer("daily_budget_tenge").notNull().default(50000),
  webhookUrl: text("webhook_url"),
  webhookSecretHash: text("webhook_secret_hash"),
  webhookSecretSetAt: timestamp("webhook_secret_set_at", { withTimezone: true }),
  testNumberAllowlist: jsonb("test_number_allowlist").$type<string[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const voiceCalls = pgTable(
  "voice_calls",
  {
    callId: text("call_id").primaryKey(),
    companyId: text("company_id").notNull(),
    providerCallId: text("provider_call_id").notNull(),
    provider: text("provider").notNull().default("mock"),
    mode: text("mode").notNull().default("demo"),
    direction: text("direction").notNull().default("inbound"),
    clientName: text("client_name"),
    clientPhone: text("client_phone").notNull().default(""),
    language: text("language").notNull().default("ru"),
    state: text("state").notNull().default("received"),
    outcome: text("outcome"),
    intent: text("intent"),
    consentGiven: boolean("consent_given").notNull().default(false),
    summary: text("summary").notNull().default(""),
    leadId: text("lead_id"),
    bookingId: text("booking_id"),
    handoff: jsonb("handoff").$type<Record<string, unknown> | null>(),
    errors: jsonb("errors").$type<Record<string, unknown>[]>().notNull().default([]),
    unansweredQuestions: jsonb("unanswered_questions").$type<string[]>().notNull().default([]),
    durationSec: integer("duration_sec").notNull().default(0),
    costTenge: integer("cost_tenge").notNull().default(0),
    scenarioId: text("scenario_id"),
    correlationId: text("correlation_id").notNull().default(""),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("voice_calls_company_started_idx").on(t.companyId, t.startedAt)],
)

export const voiceCallTransitions = pgTable(
  "voice_call_transitions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    callId: text("call_id").notNull(),
    companyId: text("company_id").notNull(),
    fromState: text("from_state").notNull(),
    toState: text("to_state").notNull(),
    note: text("note"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("voice_call_transitions_call_idx").on(t.callId, t.id)],
)

export const voiceTranscripts = pgTable(
  "voice_transcripts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    callId: text("call_id").notNull(),
    companyId: text("company_id").notNull(),
    role: text("role").notNull(),
    text: text("text").notNull(),
    state: text("state").notNull(),
    isFinal: boolean("is_final").notNull().default(true),
    language: text("language").notNull().default("ru"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("voice_transcripts_call_idx").on(t.callId, t.id)],
)

export const voiceLeads = pgTable(
  "voice_leads",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull(),
    callId: text("call_id").notNull(),
    name: text("name").notNull().default(""),
    phone: text("phone").notNull().default(""),
    interest: text("interest").notNull().default(""),
    niche: text("niche").notNull().default(""),
    service: text("service").notNull().default(""),
    source: text("source").notNull().default("voice_ai"),
    intent: text("intent").notNull().default(""),
    score: integer("score").notNull().default(0),
    temperature: text("temperature").notNull().default("cold"),
    comment: text("comment").notNull().default(""),
    managerSummary: text("manager_summary").notNull().default(""),
    nextBestAction: text("next_best_action").notNull().default(""),
    crmStatus: text("crm_status").notNull().default("pending_retry"),
    crmExternalId: text("crm_external_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("voice_leads_company_idx").on(t.companyId, t.createdAt)],
)

export const voiceBookings = pgTable(
  "voice_bookings",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull(),
    callId: text("call_id").notNull(),
    leadId: text("lead_id"),
    serviceId: text("service_id").notNull().default(""),
    service: text("service").notNull().default(""),
    locationId: text("location_id"),
    staffId: text("staff_id"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    timezone: text("timezone").notNull().default("Asia/Almaty"),
    status: text("status").notNull().default("pending_manager"),
    provider: text("provider").notNull().default("mock"),
    providerBookingId: text("provider_booking_id"),
    calendarStatus: text("calendar_status").notNull().default("pending_retry"),
    idempotencyKey: text("idempotency_key").notNull(),
    holdId: text("hold_id"),
    cancelledReason: text("cancelled_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("voice_bookings_idem_idx").on(t.companyId, t.idempotencyKey)],
)

export const voiceSlotHolds = pgTable("voice_slot_holds", {
  holdId: text("hold_id").primaryKey(),
  companyId: text("company_id").notNull(),
  callId: text("call_id").notNull(),
  serviceId: text("service_id").notNull().default(""),
  locationId: text("location_id"),
  staffId: text("staff_id"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("held"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const voiceFollowUps = pgTable("voice_follow_ups", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  callId: text("call_id").notNull(),
  channel: text("channel").notNull(),
  recipient: text("recipient").notNull().default(""),
  text: text("text").notNull().default(""),
  status: text("status").notNull().default("queued"),
  reason: text("reason").notNull().default(""),
  errorReason: text("error_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const voiceOutboxEvents = pgTable(
  "voice_outbox_events",
  {
    eventId: text("event_id").primaryKey(),
    companyId: text("company_id").notNull(),
    callId: text("call_id"),
    type: text("type").notNull(),
    schemaVersion: text("schema_version").notNull().default("1"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(6),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("voice_outbox_idem_idx").on(t.companyId, t.idempotencyKey),
    index("voice_outbox_pending_idx").on(t.status, t.nextAttemptAt),
  ],
)

export const voiceInboundEvents = pgTable(
  "voice_inbound_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    companyId: text("company_id").notNull(),
    source: text("source").notNull(),
    eventId: text("event_id").notNull(),
    signaturePrefix: text("signature_prefix").notNull().default(""),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("voice_inbound_events_uniq").on(t.companyId, t.source, t.eventId)],
)

export const voiceAuditLog = pgTable(
  "voice_audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    companyId: text("company_id").notNull(),
    actor: text("actor").notNull().default("system"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull().default(""),
    targetId: text("target_id").notNull().default(""),
    outcome: text("outcome").notNull().default("ok"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    correlationId: text("correlation_id").notNull().default(""),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("voice_audit_company_idx").on(t.companyId, t.at)],
)

export const voiceTurnMetrics = pgTable(
  "voice_turn_metrics",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    companyId: text("company_id").notNull(),
    callId: text("call_id").notNull(),
    turnIndex: integer("turn_index").notNull().default(0),
    mode: text("mode").notNull().default("demo"),
    vadEndMs: integer("vad_end_ms"),
    sttPartialMs: integer("stt_partial_ms"),
    sttFinalMs: integer("stt_final_ms"),
    knowledgeMs: integer("knowledge_ms"),
    llmFirstTokenMs: integer("llm_first_token_ms"),
    llmCompleteMs: integer("llm_complete_ms"),
    ttsFirstAudioMs: integer("tts_first_audio_ms"),
    firstAudioDeliveredMs: integer("first_audio_delivered_ms"),
    fullTurnMs: integer("full_turn_ms"),
    bookingProviderMs: integer("booking_provider_ms"),
    handoffMs: integer("handoff_ms"),
    interrupted: boolean("interrupted").notNull().default(false),
    interruptionHandled: boolean("interruption_handled").notNull().default(false),
    emptyTranscript: boolean("empty_transcript").notNull().default(false),
    fallbackUsed: boolean("fallback_used").notNull().default(false),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("voice_turn_metrics_company_idx").on(t.companyId, t.at)],
)

export const voiceKnowledgeVersions = pgTable(
  "voice_knowledge_versions",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull(),
    version: integer("version").notNull(),
    status: text("status").notNull().default("draft"),
    note: text("note").notNull().default(""),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("voice_knowledge_versions_uniq").on(t.companyId, t.version)],
)

export const voiceKnowledgeDocs = pgTable(
  "voice_knowledge_docs",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull(),
    versionId: text("version_id").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    source: text("source").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("voice_knowledge_docs_company_idx").on(t.companyId, t.versionId)],
)

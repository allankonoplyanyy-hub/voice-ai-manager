// Режимы работы и preflight gate.
// Смысл: система обязана честно отвечать, что она умеет прямо сейчас, и физически
// запрещать действия, для которых нет настроенных провайдеров.

export type OperatingMode = "demo" | "test" | "live" | "degraded" | "disabled"

export type Capability =
  | "accept_real_calls"
  | "outbound_calls"
  | "real_stt"
  | "real_llm"
  | "real_tts"
  | "write_crm"
  | "write_calendar"
  | "send_messaging"
  | "store_recordings"

/** Что разрешено в каждом режиме. Единственный источник истины для гейта. */
const MODE_CAPABILITIES: Record<OperatingMode, ReadonlySet<Capability>> = {
  // demo: полностью изолированный прогон на сценариях, никаких внешних записей.
  demo: new Set<Capability>([]),
  // test: реальный конвейер, но только на allowlist-номерах и без записи в CRM/календарь.
  test: new Set<Capability>(["accept_real_calls", "real_stt", "real_llm", "real_tts"]),
  // live: полный доступ.
  live: new Set<Capability>([
    "accept_real_calls",
    "outbound_calls",
    "real_stt",
    "real_llm",
    "real_tts",
    "write_crm",
    "write_calendar",
    "send_messaging",
    "store_recordings",
  ]),
  // degraded: звонки принимаем, но внешние записи отключены — работаем в режиме приёма заявок.
  degraded: new Set<Capability>(["accept_real_calls", "real_stt", "real_llm", "real_tts"]),
  // disabled: не принимаем ничего.
  disabled: new Set<Capability>([]),
}

export function modeAllows(mode: OperatingMode, capability: Capability): boolean {
  return MODE_CAPABILITIES[mode].has(capability)
}

export function capabilitiesOf(mode: OperatingMode): Capability[] {
  return [...MODE_CAPABILITIES[mode]]
}

export function isOperatingMode(value: unknown): value is OperatingMode {
  return value === "demo" || value === "test" || value === "live" || value === "degraded" || value === "disabled"
}

export interface PreflightCheck {
  id: string
  label: string
  required: boolean
  passed: boolean
  detail: string
}

export interface PreflightReport {
  requestedMode: OperatingMode
  effectiveMode: OperatingMode
  ready: boolean
  checks: PreflightCheck[]
  blockingReasons: string[]
}

export interface PreflightInput {
  requestedMode: OperatingMode
  hasDatabase: boolean
  hasTelephony: boolean
  hasStt: boolean
  hasLlm: boolean
  hasTts: boolean
  hasCrm: boolean
  hasCalendar: boolean
  hasMessaging: boolean
  hasWebhookSecret: boolean
  hasKnowledgeBase: boolean
  testAllowlistSize: number
}

/**
 * Preflight gate: сверяет запрошенный режим с фактически настроенными провайдерами.
 * Если для режима не хватает обязательного компонента — режим понижается, а не падает.
 * live -> degraded при отсутствии CRM/календаря; всё остальное -> demo.
 */
export function runPreflight(input: PreflightInput): PreflightReport {
  const checks: PreflightCheck[] = []
  const mode = input.requestedMode

  const needsRealPipeline = mode === "live" || mode === "test" || mode === "degraded"
  const needsExternalWrites = mode === "live"

  const add = (id: string, label: string, required: boolean, passed: boolean, detail: string) =>
    checks.push({ id, label, required, passed, detail })

  add(
    "database",
    "База данных доступна",
    true,
    input.hasDatabase,
    input.hasDatabase ? "DATABASE_URL настроен" : "DATABASE_URL отсутствует — состояние звонков не сохранится",
  )
  add(
    "webhook_secret",
    "Секрет вебхуков задан",
    needsRealPipeline,
    input.hasWebhookSecret,
    input.hasWebhookSecret ? "HMAC-секрет настроен" : "Нет секрета — входящие вебхуки невозможно проверить",
  )
  add(
    "telephony",
    "Телефонный провайдер",
    needsRealPipeline,
    input.hasTelephony,
    input.hasTelephony ? "Провайдер настроен" : "Нет телефонии — реальные звонки приниматься не могут",
  )
  add("stt", "Распознавание речи", needsRealPipeline, input.hasStt, input.hasStt ? "STT настроен" : "STT не настроен")
  add("llm", "Языковая модель", needsRealPipeline, input.hasLlm, input.hasLlm ? "LLM настроен" : "LLM не настроен")
  add("tts", "Синтез речи", needsRealPipeline, input.hasTts, input.hasTts ? "TTS настроен" : "TTS не настроен")
  add(
    "knowledge",
    "База знаний опубликована",
    needsRealPipeline,
    input.hasKnowledgeBase,
    input.hasKnowledgeBase ? "Есть опубликованная версия" : "Нет опубликованной версии базы знаний",
  )
  add(
    "crm",
    "CRM подключена",
    needsExternalWrites,
    input.hasCrm,
    input.hasCrm ? "CRM настроена" : "CRM не настроена — лиды не уйдут во внешнюю систему",
  )
  add(
    "calendar",
    "Календарь подключён",
    needsExternalWrites,
    input.hasCalendar,
    input.hasCalendar ? "Календарь настроен" : "Календарь не настроен — записи не подтверждаются автоматически",
  )
  add(
    "messaging",
    "Канал сообщений подключён",
    false,
    input.hasMessaging,
    input.hasMessaging ? "Канал настроен" : "Канал не настроен — follow-up останется в очереди",
  )
  add(
    "test_allowlist",
    "Allowlist тестовых номеров",
    mode === "test",
    input.testAllowlistSize > 0,
    input.testAllowlistSize > 0
      ? `${input.testAllowlistSize} номер(ов) в allowlist`
      : "В test-режиме нужен хотя бы один разрешённый номер",
  )

  const failedRequired = checks.filter((c) => c.required && !c.passed)
  const blockingReasons = failedRequired.map((c) => c.detail)

  let effectiveMode = mode
  if (failedRequired.length > 0) {
    const pipelineBroken = failedRequired.some((c) =>
      ["database", "telephony", "stt", "llm", "tts", "webhook_secret", "knowledge", "test_allowlist"].includes(c.id),
    )
    effectiveMode = pipelineBroken ? "demo" : "degraded"
  }

  return {
    requestedMode: mode,
    effectiveMode,
    ready: failedRequired.length === 0,
    checks,
    blockingReasons,
  }
}

export class CapabilityDeniedError extends Error {
  readonly capability: Capability
  readonly mode: OperatingMode
  constructor(mode: OperatingMode, capability: Capability) {
    super(`Действие "${capability}" запрещено в режиме "${mode}"`)
    this.name = "CapabilityDeniedError"
    this.mode = mode
    this.capability = capability
  }
}

/** Бросает исключение, если режим не даёт права. Вызывается перед каждой внешней записью. */
export function assertCapability(mode: OperatingMode, capability: Capability): void {
  if (!modeAllows(mode, capability)) throw new CapabilityDeniedError(mode, capability)
}

/**
 * Проверка номера для test-режима. В test звонить можно только на явно разрешённые номера,
 * чтобы тестовый прогон не дозвонился до реального клиента.
 */
export function isNumberAllowed(mode: OperatingMode, phone: string, allowlist: string[]): boolean {
  if (mode !== "test") return true
  const normalized = normalizePhone(phone)
  return allowlist.some((entry) => normalizePhone(entry) === normalized)
}

export function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "")
}

// Фактическое состояние среды: что система умеет прямо сейчас.
//
// Единственное место, где абстрактный preflight из modes.ts встречается с
// реальными переменными окружения. Раньше preflight существовал, но никем не
// вызывался, а страница настроек показывала утверждения, написанные руками —
// то есть могла врать. Здесь режим выводится из фактов.

import { runPreflight, type OperatingMode, type PreflightReport } from "./modes"

function isSet(name: string): boolean {
  const value = process.env[name]
  return typeof value === "string" && value.trim().length > 0
}

/** Разрешённые номера для test-режима. */
export function testAllowlist(): string[] {
  const raw = process.env.VOICE_TEST_ALLOWLIST ?? ""
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Запрошенный режим из окружения.
 *
 * По умолчанию demo: система не должна случайно оказаться в режиме приёма
 * реальных звонков из-за незаданной переменной.
 */
export function requestedMode(): OperatingMode {
  const raw = (process.env.VOICE_MODE ?? "demo").trim()
  if (raw === "test" || raw === "live" || raw === "degraded" || raw === "disabled") return raw
  return "demo"
}

/**
 * Preflight по фактическому окружению.
 *
 * Провайдеры медиа-тракта (телефония, STT, LLM, TTS) не реализованы, поэтому
 * соответствующие проверки не пройдут, и запрос live будет понижен до demo.
 * Это намеренно: гейт обязан отражать реальность, а не намерения.
 */
export function currentPreflight(): PreflightReport {
  return runPreflight({
    requestedMode: requestedMode(),
    hasDatabase: isSet("DATABASE_URL") || isSet("POSTGRES_URL"),
    hasTelephony: isSet("VOICE_TELEPHONY_PROVIDER"),
    hasStt: isSet("VOICE_STT_PROVIDER"),
    hasLlm: isSet("VOICE_LLM_PROVIDER") || isSet("AI_GATEWAY_API_KEY"),
    hasTts: isSet("VOICE_TTS_PROVIDER"),
    hasCrm: isSet("VOICE_CRM_PROVIDER"),
    hasCalendar: isSet("VOICE_CALENDAR_PROVIDER"),
    hasMessaging: isSet("VOICE_MESSAGING_PROVIDER"),
    hasWebhookSecret: isSet("VOICE_CONTROL_CENTER_SECRET"),
    hasKnowledgeBase: isSet("VOICE_KNOWLEDGE_VERSION"),
    testAllowlistSize: testAllowlist().length,
  })
}

/** Режим, в котором система фактически работает. */
export function effectiveMode(): OperatingMode {
  return currentPreflight().effectiveMode
}

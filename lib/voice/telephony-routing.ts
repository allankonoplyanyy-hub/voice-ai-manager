// Маршрутизация номеров по компаниям.
//
// Схема выбирается для каждой компании отдельно: одна переадресует свой номер
// на SIP ассистента, другая берёт номер в аренду у провайдера. Ни одна не
// навязывается всем.
//
// Живая конфигурация задаётся переменной VOICE_TELEPHONY_ROUTING (JSON-массив).
// Если она не задана или содержит ошибку, используется demo-конфигурация: сами
// номера компаний без SIP-адресов, то есть неготовые к живым звонкам. Молча
// принять полурабочую настройку хуже, чем остаться в demo: во втором случае это
// видно сразу.

import { DEMO_TENANTS } from "./tenants"
import {
  buildNumberIndex,
  normalizePhone,
  type NumberIndex,
  type RoutingKind,
  type TelephonyProviderId,
  type TelephonyRouting,
  routingReadiness,
} from "./providers/telephony"

const ROUTING_ENV = "VOICE_TELEPHONY_ROUTING"

function isRoutingKind(value: unknown): value is RoutingKind {
  return value === "forwarded" || value === "rented"
}

function isProviderId(value: unknown): value is TelephonyProviderId {
  return value === "twilio" || value === "telnyx"
}

/** Demo-маршрутизация: номера из карточек компаний, SIP не настроен. */
function demoRouting(): TelephonyRouting[] {
  return DEMO_TENANTS.map((t) => ({
    companyId: t.companyId,
    kind: "forwarded" as const,
    publicNumber: normalizePhone(t.phoneNumber) ?? t.phoneNumber,
    sipUri: null,
    provider: null,
  }))
}

/**
 * Разбирает одну запись из переменной окружения.
 *
 * Неизвестные поля игнорируются, некорректная запись отбрасывается целиком:
 * половина настройки маршрутизации хуже её отсутствия.
 */
function parseEntry(raw: unknown): TelephonyRouting | null {
  if (typeof raw !== "object" || raw === null) return null
  const o = raw as Record<string, unknown>

  const companyId = typeof o.companyId === "string" ? o.companyId.trim() : ""
  const publicNumber = normalizePhone(typeof o.publicNumber === "string" ? o.publicNumber : null)
  if (!companyId || !publicNumber) return null

  const kind = isRoutingKind(o.kind) ? o.kind : null
  if (!kind) return null

  const sipUri = typeof o.sipUri === "string" && o.sipUri.trim().length > 0 ? o.sipUri.trim() : null
  const provider = isProviderId(o.provider) ? o.provider : null

  return {
    companyId,
    kind,
    publicNumber,
    // Поля, не относящиеся к выбранной схеме, обнуляются: иначе в настройках
    // остаётся мусор, который выглядит как рабочая конфигурация.
    sipUri: kind === "forwarded" ? sipUri : null,
    provider: kind === "rented" ? provider : null,
  }
}

export interface RoutingConfig {
  routings: TelephonyRouting[]
  index: NumberIndex
  /** Источник конфигурации: полезно в диагностике. */
  source: "env" | "demo"
  /** Проблемы конфигурации, из-за которых часть звонков не примется. */
  issues: string[]
}

function buildConfig(routings: TelephonyRouting[], source: "env" | "demo"): RoutingConfig {
  const index = buildNumberIndex(routings)
  const issues: string[] = []

  for (const number of index.collisions) {
    issues.push(`Номер ${number} заявлен несколькими компаниями — звонки на него не принимаются`)
  }
  for (const companyId of index.invalid) {
    issues.push(`Компания ${companyId}: номер записан некорректно`)
  }

  return { routings, index, source, issues }
}

/** Текущая конфигурация маршрутизации. */
export function routingConfig(): RoutingConfig {
  const raw = process.env[ROUTING_ENV]
  if (!raw || raw.trim().length === 0) return buildConfig(demoRouting(), "demo")

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return buildConfig(demoRouting(), "demo")
  }

  if (!Array.isArray(parsed)) return buildConfig(demoRouting(), "demo")

  const entries = parsed.map(parseEntry).filter((e): e is TelephonyRouting => e !== null)
  if (entries.length === 0) return buildConfig(demoRouting(), "demo")

  return buildConfig(entries, "env")
}

/** Маршрутизация конкретной компании. */
export function getRouting(companyId: string): TelephonyRouting | null {
  return routingConfig().routings.find((r) => r.companyId === companyId) ?? null
}

export interface CompanyRoutingStatus {
  companyId: string
  kind: RoutingKind
  publicNumber: string
  ready: boolean
  missing: string[]
}

/** Готовность маршрутизации компании к живым звонкам. */
export function companyRoutingStatus(companyId: string): CompanyRoutingStatus | null {
  const routing = getRouting(companyId)
  if (!routing) return null

  const readiness = routingReadiness(routing)
  return {
    companyId: routing.companyId,
    kind: routing.kind,
    publicNumber: routing.publicNumber,
    ready: readiness.ready,
    missing: readiness.missing,
  }
}

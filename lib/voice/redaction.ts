// Маскирование персональных данных в логах и аудите.
// Правило: в базе транскрипт хранится как есть (он нужен менеджеру),
// но в логи, аудит и исходящие вебхуки PII попадает только в замаскированном виде.

const PHONE_RE = /(\+?\d[\d\s\-()]{7,}\d)/g
const EMAIL_RE = /([\w.+-]+)@([\w-]+\.[\w.-]+)/g
const CARD_RE = /\b(?:\d[ -]?){13,19}\b/g
const IIN_RE = /\b\d{12}\b/g

/** Телефон: оставляем код страны и последние 2 цифры. +7 777 123 45 67 -> +7*******67 */
export function maskPhone(value: string): string {
  const digits = value.replace(/[^\d]/g, "")
  if (digits.length < 4) return "*".repeat(digits.length)
  const prefix = value.trim().startsWith("+") ? "+" : ""
  return `${prefix}${digits.slice(0, 1)}${"*".repeat(Math.max(digits.length - 3, 0))}${digits.slice(-2)}`
}

export function maskEmail(value: string): string {
  return value.replace(EMAIL_RE, (_m, local: string, domain: string) => {
    const head = local.slice(0, 1)
    return `${head}${"*".repeat(Math.max(local.length - 1, 1))}@${domain}`
  })
}

/** Имя: первая буква + маска. Нужно, чтобы в логах можно было отличать людей, но не читать их. */
export function maskName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  return trimmed
    .split(/\s+/)
    .map((part) => `${part.slice(0, 1)}${"*".repeat(Math.max(part.length - 1, 1))}`)
    .join(" ")
}

/** Универсальная чистка свободного текста: карты, ИИН, телефоны, email. */
export function redactText(value: string): string {
  return value
    .replace(CARD_RE, (m) => (m.replace(/[^\d]/g, "").length >= 13 ? "[card]" : m))
    .replace(IIN_RE, "[id]")
    .replace(EMAIL_RE, (m) => maskEmail(m))
    .replace(PHONE_RE, (m) => maskPhone(m))
}

const SENSITIVE_KEYS = new Set([
  "phone",
  "clientphone",
  "recipient",
  "secret",
  "webhooksecret",
  "token",
  "apikey",
  "authorization",
  "password",
  "signature",
])

const NAME_KEYS = new Set(["name", "clientname", "targetmanager"])

/**
 * Рекурсивно маскирует объект перед логированием.
 * Секреты вырезаются полностью, телефоны/имена маскируются, строки чистятся регулярками.
 */
export function redactObject(input: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limit]"
  if (input === null || input === undefined) return input
  if (typeof input === "string") return redactText(input)
  if (typeof input === "number" || typeof input === "boolean") return input
  if (Array.isArray(input)) return input.map((item) => redactObject(item, depth + 1))
  if (typeof input === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      const lower = key.toLowerCase()
      if (lower.includes("secret") || lower.includes("token") || lower.includes("password") || lower.includes("apikey")) {
        out[key] = "[redacted]"
      } else if (SENSITIVE_KEYS.has(lower)) {
        out[key] = typeof value === "string" ? maskPhone(value) : "[redacted]"
      } else if (NAME_KEYS.has(lower)) {
        out[key] = typeof value === "string" ? maskName(value) : value
      } else {
        out[key] = redactObject(value, depth + 1)
      }
    }
    return out
  }
  return "[unsupported]"
}

/** Структурированный лог с автоматической редакцией. */
export function safeLog(event: string, data: Record<string, unknown>): void {
  console.log(`[v0] ${event}`, JSON.stringify(redactObject(data)))
}

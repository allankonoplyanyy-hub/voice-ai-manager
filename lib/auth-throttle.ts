// Ограничение частоты попыток входа и регистрации.
//
// Встроенный лимит Better Auth здесь не подходит: он общий на все запросы к
// /api/auth и включается только в продакшене, поэтому подбор пароля в превью
// вообще ничем не сдержан. Нужен отдельный узкий лимит именно на попытки входа.

import { loginIpLimiter, loginLimiter, signUpLimiter } from "@/lib/voice/rate-limit"
import type { RateLimiter } from "@/lib/voice/rate-limit"

/** Ключ, под который попадают запросы с неопределённым адресом. */
export const UNKNOWN_IP = "unknown"

/**
 * Определяет адрес клиента по заголовкам платформы.
 *
 * `x-forwarded-for` клиент может прислать сам, и если читать его целиком, то
 * подбор пароля обходит лимит подстановкой нового адреса в каждый запрос.
 * Поэтому сначала берётся `x-real-ip`, который проставляет сама платформа, а из
 * `x-forwarded-for` — только последний элемент: его дописывает ближайший прокси
 * поверх всего, что прислал клиент.
 */
export function clientIp(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim()
  if (realIp) return realIp

  const forwarded = headers.get("x-forwarded-for")
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
    const last = parts.at(-1)
    if (last) return last
  }

  return UNKNOWN_IP
}

/** Приводит почту к нижнему регистру, чтобы регистр не давал новое ведро. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

export type AuthAttemptKind = "sign-in" | "sign-up" | "other"

/**
 * Относит запрос к попытке входа, регистрации или к чему-то ещё.
 *
 * Ограничивать весь /api/auth нельзя: там же живут выход и чтение сессии,
 * которые дёргаются на каждой странице и мгновенно исчерпали бы лимит.
 */
export function classifyAuthRequest(method: string, pathname: string): AuthAttemptKind {
  if (method !== "POST") return "other"
  if (/\/sign-in(\/|$)/.test(pathname)) return "sign-in"
  if (/\/sign-up(\/|$)/.test(pathname)) return "sign-up"
  return "other"
}

export interface ThrottleDecision {
  allowed: boolean
  retryAfterSec: number
  /** Ведра, из которых списаны токены — их возвращают при успешном входе. */
  spent: Array<{ limiter: RateLimiter; key: string }>
}

const ALLOWED: ThrottleDecision = { allowed: false, retryAfterSec: 0, spent: [] }

/**
 * Списывает попытку и говорит, пропускать ли запрос.
 *
 * Токены списываются до обработки, а при успехе возвращаются через `refund`:
 * лимит должен расходоваться на неудачные попытки, а не на обычную работу.
 */
export function throttleAuthAttempt(params: {
  kind: AuthAttemptKind
  ip: string
  email: string | null
  now?: number
}): ThrottleDecision {
  const { kind, ip, email, now } = params
  if (kind === "other") return { ...ALLOWED, allowed: true }

  const spent: ThrottleDecision["spent"] = []

  if (kind === "sign-up") {
    const result = signUpLimiter.check(ip, now)
    if (!result.allowed) {
      return { allowed: false, retryAfterSec: result.retryAfterSec, spent: [] }
    }
    spent.push({ limiter: signUpLimiter, key: ip })
    return { allowed: true, retryAfterSec: 0, spent }
  }

  // Лимит на адрес проверяется первым: он должен сработать даже тогда, когда
  // почта в каждом запросе новая и ведро пары всегда полное.
  const byIp = loginIpLimiter.check(ip, now)
  if (!byIp.allowed) {
    return { allowed: false, retryAfterSec: byIp.retryAfterSec, spent: [] }
  }
  spent.push({ limiter: loginIpLimiter, key: ip })

  // Запрос без почты дальше всё равно не пройдёт, но списанный токен на адрес
  // не даёт заваливать вход пустыми телами.
  if (!email) return { allowed: true, retryAfterSec: 0, spent }

  const pairKey = `${ip}|${email}`
  const byPair = loginLimiter.check(pairKey, now)
  if (!byPair.allowed) {
    return { allowed: false, retryAfterSec: byPair.retryAfterSec, spent: [] }
  }
  spent.push({ limiter: loginLimiter, key: pairKey })

  return { allowed: true, retryAfterSec: 0, spent }
}

/** Возвращает списанные токены — вызывается после удачного входа. */
export function refundAuthAttempt(decision: ThrottleDecision, now?: number): void {
  for (const { limiter, key } of decision.spent) {
    limiter.refund(key, now)
  }
}

/** Сбрасывает все лимиты входа. Нужен тестам, чтобы они не влияли друг на друга. */
export function resetAuthThrottle(): void {
  loginLimiter.reset()
  loginIpLimiter.reset()
  signUpLimiter.reset()
}

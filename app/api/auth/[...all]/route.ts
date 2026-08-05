import { NextResponse } from "next/server"
import { toNextJsHandler } from "better-auth/next-js"
import { auth } from "@/lib/auth"
import {
  classifyAuthRequest,
  clientIp,
  normalizeEmail,
  refundAuthAttempt,
  throttleAuthAttempt,
} from "@/lib/auth-throttle"

const handler = toNextJsHandler(auth.handler)

/**
 * Пропускает запрос через лимит попыток входа.
 *
 * Ограничиваются только вход и регистрация. Выход и чтение сессии идут мимо:
 * они выполняются на каждой странице, и общий лимит закрыл бы работу всем.
 */
async function guarded(request: Request): Promise<Response> {
  const kind = classifyAuthRequest(request.method, new URL(request.url).pathname)

  if (kind === "other") {
    return handler.POST(request as Parameters<typeof handler.POST>[0])
  }

  // Тело читается с копии: поток запроса одноразовый, и разбор оригинала
  // оставил бы обработчик Better Auth без данных.
  const body = await request
    .clone()
    .json()
    .catch(() => null)
  const email = normalizeEmail((body as { email?: unknown } | null)?.email)

  const decision = throttleAuthAttempt({ kind, ip: clientIp(request.headers), email })

  if (!decision.allowed) {
    // Ответ намеренно не уточняет, существует ли такая почта: иначе перебор
    // сначала собрал бы список действующих адресов, а уже потом пароли.
    return NextResponse.json(
      { error: "Слишком много попыток. Повторите позже." },
      { status: 429, headers: { "Retry-After": String(decision.retryAfterSec) } },
    )
  }

  const response = await handler.POST(request as Parameters<typeof handler.POST>[0])

  // Удачная попытка лимит не расходует, иначе обычная работа в системе
  // упиралась бы в тот же счётчик, что и подбор пароля.
  if (response.status < 400) {
    refundAuthAttempt(decision)
  }

  return response
}

export const GET = handler.GET
export const POST = guarded

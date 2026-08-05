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

  // Публичная точка регистрации Better Auth закрыта наглухо.
  //
  // Она создаёт аккаунт по одной почте с паролем, минуя код приглашения:
  // проверка кода живёт в серверном действии, и обращение к этому адресу
  // напрямую её обходило. Так в системе появлялись аккаунты без компании в
  // любом количестве — данные они не видели, но таблицу пользователей можно
  // было засыпать регистрациями.
  //
  // Серверное действие вызывает auth.api.signUpEmail внутри процесса, а не по
  // HTTP, поэтому штатная регистрация продолжает работать.
  if (kind === "sign-up") {
    return NextResponse.json(
      { error: "Регистрация возможна только по коду приглашения." },
      { status: 404 },
    )
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

  // Удачный вход лимит не расходует, иначе обычная работа в системе упиралась
  // бы в тот же счётчик, что и подбор пароля.
  //
  // Для регистрации всё наоборот: там ограничивается именно число созданных
  // аккаунтов, поэтому успех обязан списывать попытку. С возвратом токена
  // счётчик не исчерпывался бы никогда, и таблицу пользователей можно было бы
  // засыпать регистрациями без ограничения.
  if (response.status < 400 && kind === "sign-in") {
    refundAuthAttempt(decision)
  }

  return response
}

export const GET = handler.GET
export const POST = guarded

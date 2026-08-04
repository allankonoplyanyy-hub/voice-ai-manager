import { NextResponse } from "next/server"

import { type AuthContext, NoCompanyError, UnauthorizedError, requireAuth } from "@/lib/auth-context"

/**
 * Проверка доступа для HTTP-маршрутов.
 *
 * Возвращает либо контекст пользователя, либо готовый ответ с ошибкой —
 * маршруту остаётся проверить наличие поля `response` и вернуть его.
 * Такой вид выбран потому, что из обработчика нельзя «перенаправить», как со
 * страницы: клиенту нужен корректный код состояния.
 */
export type ApiAuthResult = { ctx: AuthContext; response?: never } | { ctx?: never; response: NextResponse }

export async function authenticateRequest(): Promise<ApiAuthResult> {
  try {
    return { ctx: await requireAuth() }
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return { response: NextResponse.json({ error: "Требуется вход" }, { status: 401 }) }
    }
    if (error instanceof NoCompanyError) {
      return {
        response: NextResponse.json({ error: "Пользователь не привязан к компании" }, { status: 403 }),
      }
    }
    throw error
  }
}

/**
 * То же, плюс сверка компании из адреса с компанией из сессии.
 *
 * Значение из пути запроса нельзя использовать для выборки данных: оно легко
 * подменяется. Поэтому оно только сравнивается с сессией, а при расхождении
 * отдаётся 404 — чтобы по коду ответа нельзя было проверить существование
 * чужой компании.
 */
export async function authenticateCompanyRequest(requestedCompanyId: string): Promise<ApiAuthResult> {
  const result = await authenticateRequest()
  if (result.response) return result
  if (result.ctx.companyId !== requestedCompanyId) {
    return { response: NextResponse.json({ error: "Компания не найдена" }, { status: 404 }) }
  }
  return result
}

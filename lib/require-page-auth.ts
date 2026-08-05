import { redirect } from "next/navigation"

import { type AuthContext, NoCompanyError, requireAuth } from "@/lib/auth-context"

/**
 * Проверка доступа для серверных страниц.
 *
 * В отличие от API, страница не отдаёт 401, а отправляет человека на вход:
 * для пользователя это выглядит как обычный переход, а не как ошибка.
 *
 * Два случая различаются намеренно. Не вошёл — на страницу входа. Вошёл, но не
 * привязан к компании — на отдельный экран: отправлять его на вход было бы
 * бесконечным циклом, ведь сессия у него уже есть.
 */
export async function requirePageAuth(): Promise<AuthContext> {
  try {
    return await requireAuth()
  } catch (error) {
    if (error instanceof NoCompanyError) redirect("/no-company")
    redirect("/sign-in")
  }
}

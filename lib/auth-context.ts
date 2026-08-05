import { and, eq } from "drizzle-orm"
import { headers } from "next/headers"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { voiceCompanyMembers } from "@/lib/db/schema"

export type CompanyRole = "owner" | "operator"

export type AuthContext = {
  userId: string
  email: string
  name: string
  companyId: string
  role: CompanyRole
}

export class UnauthorizedError extends Error {
  constructor(message = "Требуется вход") {
    super(message)
    this.name = "UnauthorizedError"
  }
}

export class NoCompanyError extends Error {
  constructor(message = "Пользователь не привязан к компании") {
    super(message)
    this.name = "NoCompanyError"
  }
}

/**
 * Возвращает пользователя и его компанию из активной сессии.
 *
 * companyId берётся ТОЛЬКО отсюда. Раньше он приходил из URL, из-за чего любой
 * человек мог подставить чужой идентификатор и прочитать звонки, телефоны и
 * заявки другой компании. Единая точка получения компании убирает эту
 * возможность: подделать значение в адресной строке больше нельзя.
 */
export async function requireAuth(): Promise<AuthContext> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new UnauthorizedError()

  const [membership] = await db
    .select({
      companyId: voiceCompanyMembers.companyId,
      role: voiceCompanyMembers.role,
    })
    .from(voiceCompanyMembers)
    .where(eq(voiceCompanyMembers.userId, session.user.id))
    .limit(1)

  if (!membership) throw new NoCompanyError()

  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    companyId: membership.companyId,
    role: membership.role as CompanyRole,
  }
}

/**
 * Мягкий вариант: возвращает null вместо исключения.
 * Нужен страницам входа, которые лишь проверяют, вошёл ли человек.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  try {
    return await requireAuth()
  } catch {
    return null
  }
}

/**
 * Проверяет, что запрошенная компания совпадает с компанией из сессии.
 *
 * Часть маршрутов и страниц принимает companyId в пути. Значение из адреса
 * нельзя использовать для выборки данных — его сверяют с сессией, и при
 * расхождении доступ закрывается.
 */
export async function requireCompanyAccess(requestedCompanyId: string): Promise<AuthContext> {
  const ctx = await requireAuth()
  if (ctx.companyId !== requestedCompanyId) {
    throw new UnauthorizedError("Нет доступа к данным этой компании")
  }
  return ctx
}

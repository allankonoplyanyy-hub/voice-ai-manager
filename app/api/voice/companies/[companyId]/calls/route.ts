import { NextResponse } from "next/server"
import { authenticateCompanyRequest } from "@/lib/api-auth"
import { ensureSeeded, listCallsByCompany } from "@/lib/voice/persist"
import { getTenant } from "@/lib/voice/tenants"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  const { companyId } = await params

  // Проверка сессии идёт до всего остального. Раньше маршрут отдавал звонки
  // вместе с телефонами любому, кто знал идентификатор компании: сессия не
  // запрашивалась вообще, а companyId из адреса использовался напрямую.
  const auth = await authenticateCompanyRequest(companyId)
  if (auth.response) return auth.response

  if (!getTenant(companyId)) {
    return NextResponse.json({ error: "Компания не найдена" }, { status: 404 })
  }

  await ensureSeeded()
  // Выборка по companyId из сессии, а не из адреса: значения совпали выше.
  return NextResponse.json({ calls: await listCallsByCompany(auth.ctx.companyId) })
}

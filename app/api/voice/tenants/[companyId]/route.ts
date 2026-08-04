import { NextResponse } from "next/server"
import { authenticateCompanyRequest } from "@/lib/api-auth"
import { getKnowledge, getTenant } from "@/lib/voice/tenants"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  const { companyId } = await params
  // База знаний — коммерческая информация компании: скрипты, цены, условия.
  // Доступ только своей компании.
  const { response } = await authenticateCompanyRequest(companyId)
  if (response) return response

  const tenant = getTenant(companyId)
  if (!tenant) {
    return NextResponse.json({ error: "Компания не найдена" }, { status: 404 })
  }
  // Изоляция: возвращается только база знаний этой компании
  return NextResponse.json({ tenant, knowledge: getKnowledge(companyId) })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  const { companyId } = await params
  const { ctx, response } = await authenticateCompanyRequest(companyId)
  if (response) return response

  // Настройки ассистента меняют поведение на реальных звонках, поэтому правка
  // доступна только владельцу, а не любому сотруднику компании.
  if (ctx.role !== "owner") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const tenant = getTenant(companyId)
  if (!tenant) {
    return NextResponse.json({ error: "Компания не найдена" }, { status: 404 })
  }
  const body = await request.json().catch(() => null)
  return NextResponse.json({ status: "mock_updated", companyId, patch: body })
}

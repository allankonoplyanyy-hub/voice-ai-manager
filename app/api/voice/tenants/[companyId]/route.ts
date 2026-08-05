import { NextResponse } from "next/server"
import { authenticateCompanyRequest } from "@/lib/api-auth"
import { writeAudit } from "@/lib/voice/repo"
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
    // Отказ пишется в журнал наравне с успехом: попытка сотрудника изменить
    // поведение ассистента — это то, что владелец должен увидеть.
    await writeAudit({
      companyId: ctx.companyId,
      actor: ctx.email,
      action: "tenant.settings_update",
      targetType: "tenant",
      targetId: companyId,
      outcome: "denied",
      detail: { reason: "role_not_owner", role: ctx.role },
    })
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const tenant = getTenant(companyId)
  if (!tenant) {
    return NextResponse.json({ error: "Компания не найдена" }, { status: 404 })
  }
  const body = await request.json().catch(() => null)

  // В журнал попадают только имена изменённых полей. Значения могут содержать
  // цены и условия работы, а журнал доступен шире, чем сами настройки.
  await writeAudit({
    companyId: ctx.companyId,
    actor: ctx.email,
    action: "tenant.settings_update",
    targetType: "tenant",
    targetId: companyId,
    outcome: "ok",
    detail: { fields: body && typeof body === "object" ? Object.keys(body) : [] },
  })

  return NextResponse.json({ status: "mock_updated", companyId, patch: body })
}

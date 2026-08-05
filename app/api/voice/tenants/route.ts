import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/api-auth"
import { writeAudit } from "@/lib/voice/repo"
import { getTenant } from "@/lib/voice/tenants"

/**
 * Раньше отдавался весь список компаний с названиями и номерами. Теперь
 * возвращается только своя компания — перечень клиентов сервиса наружу не нужен.
 */
export async function GET() {
  const { ctx, response } = await authenticateRequest()
  if (response) return response

  const tenant = getTenant(ctx.companyId)
  return NextResponse.json({ tenants: tenant ? [tenant] : [] })
}

export async function POST(request: Request) {
  const { ctx, response } = await authenticateRequest()
  if (response) return response

  // Создание компании — операция администратора сервиса, а не рядового
  // сотрудника: раньше любой вошедший мог заявить компанию с произвольным
  // идентификатором, в том числе занять чужой.
  if (ctx.role !== "owner") {
    await writeAudit({
      companyId: ctx.companyId,
      actor: ctx.email,
      action: "tenant.create",
      targetType: "tenant",
      targetId: "unknown",
      outcome: "denied",
      detail: { reason: "role_not_owner", role: ctx.role },
    })
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  if (!body?.companyId || !body?.name) {
    return NextResponse.json(
      { error: "companyId и name обязательны" },
      { status: 400 },
    )
  }

  await writeAudit({
    companyId: ctx.companyId,
    actor: ctx.email,
    action: "tenant.create",
    targetType: "tenant",
    targetId: String(body.companyId),
    outcome: "ok",
    detail: { requestedName: String(body.name).slice(0, 120) },
  })

  // Demo-режим: создание тенанта имитируется, постоянное хранилище отсутствует.
  return NextResponse.json(
    { status: "mock_created", companyId: body.companyId },
    { status: 201 },
  )
}

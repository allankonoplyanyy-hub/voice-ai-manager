import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/api-auth"
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
  const { response } = await authenticateRequest()
  if (response) return response

  const body = await request.json().catch(() => null)
  if (!body?.companyId || !body?.name) {
    return NextResponse.json(
      { error: "companyId и name обязательны" },
      { status: 400 },
    )
  }
  // Demo-режим: создание тенанта имитируется, постоянное хранилище отсутствует.
  return NextResponse.json(
    { status: "mock_created", companyId: body.companyId },
    { status: 201 },
  )
}

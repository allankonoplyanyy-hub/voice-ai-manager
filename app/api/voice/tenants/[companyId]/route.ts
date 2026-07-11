import { NextResponse } from "next/server"
import { getKnowledge, getTenant } from "@/lib/voice/tenants"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  const { companyId } = await params
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
  const tenant = getTenant(companyId)
  if (!tenant) {
    return NextResponse.json({ error: "Компания не найдена" }, { status: 404 })
  }
  const body = await request.json().catch(() => null)
  return NextResponse.json({ status: "mock_updated", companyId, patch: body })
}

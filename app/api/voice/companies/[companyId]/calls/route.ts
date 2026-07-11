import { NextResponse } from "next/server"
import { getCallsByCompany } from "@/lib/voice/store"
import { getTenant } from "@/lib/voice/tenants"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  const { companyId } = await params
  if (!getTenant(companyId)) {
    return NextResponse.json({ error: "Компания не найдена" }, { status: 404 })
  }
  // Изоляция тенантов: только звонки этой компании
  return NextResponse.json({ calls: getCallsByCompany(companyId) })
}

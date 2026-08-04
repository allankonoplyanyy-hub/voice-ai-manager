import { NextResponse } from "next/server"
import { computeMetrics } from "@/lib/voice/analytics"
import { ensureSeeded, followUpsForCalls, listCallsByCompany } from "@/lib/voice/persist"
import { getTenant } from "@/lib/voice/tenants"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  const { companyId } = await params
  if (!getTenant(companyId)) {
    return NextResponse.json({ error: "Компания не найдена" }, { status: 404 })
  }
  const period = new URL(request.url).searchParams.get("period")
  const p = period === "today" || period === "7d" || period === "30d" ? period : "30d"

  await ensureSeeded()
  // Изоляция арендатора: читаем только звонки этой компании, follow-up — по их id.
  const calls = await listCallsByCompany(companyId)
  const followUps = await followUpsForCalls(calls.map((c) => c.callId))
  return NextResponse.json({ metrics: computeMetrics(p, calls, followUps) })
}

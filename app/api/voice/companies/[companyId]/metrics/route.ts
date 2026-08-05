import { NextResponse } from "next/server"
import { authenticateCompanyRequest } from "@/lib/api-auth"
import { computeMetrics } from "@/lib/voice/analytics"
import { ensureSeeded, followUpsForCalls, listCallsByCompany } from "@/lib/voice/persist"
import { getTenant } from "@/lib/voice/tenants"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  const { companyId } = await params
  // Компания из адреса сверяется с сессией: без этого достаточно было подставить
  // чужой идентификатор в URL, чтобы получить её метрики.
  const { response } = await authenticateCompanyRequest(companyId)
  if (response) return response

  if (!getTenant(companyId)) {
    return NextResponse.json({ error: "Компания не найдена" }, { status: 404 })
  }
  const period = new URL(request.url).searchParams.get("period")
  const p = period === "today" || period === "7d" || period === "30d" ? period : "30d"

  await ensureSeeded()
  const calls = await listCallsByCompany(companyId)
  const followUps = await followUpsForCalls(
    calls.map((c) => c.callId),
    companyId,
  )
  return NextResponse.json({ metrics: computeMetrics(p, calls, followUps) })
}

import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/api-auth"
import { getCallDetail } from "@/lib/voice/persist"
import { writeAudit } from "@/lib/voice/repo"

const VALID_REASONS = [
  "customer_request",
  "aggression",
  "out_of_knowledge",
  "vip_client",
  "complaint",
  "high_value_deal",
  "recognition_failure",
  "critical_keyword",
]

export async function POST(
  request: Request,
  { params }: { params: Promise<{ callId: string }> },
) {
  const { ctx, response } = await authenticateRequest()
  if (response) return response

  const { callId } = await params
  const detail = await getCallDetail(callId, ctx.companyId)
  if (!detail) {
    return NextResponse.json({ error: "Звонок не найден" }, { status: 404 })
  }
  const body = await request.json().catch(() => null)
  if (!body?.reason || !VALID_REASONS.includes(body.reason)) {
    return NextResponse.json(
      { error: "reason обязателен и должен быть одним из: " + VALID_REASONS.join(", ") },
      { status: 400 },
    )
  }
  // Передача разговора оператору меняет обслуживание клиента, поэтому в журнале
  // должно остаться, кто именно её запросил.
  await writeAudit({
    companyId: ctx.companyId,
    actor: ctx.email,
    action: "call.handoff_requested",
    targetType: "call",
    targetId: callId,
    outcome: "ok",
    detail: { reason: body.reason },
  })

  return NextResponse.json({
    status: "mock_handoff_queued",
    callId,
    companyId: detail.call.companyId,
    reason: body.reason,
  })
}

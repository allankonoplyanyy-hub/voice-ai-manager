import { NextResponse } from "next/server"
import { getCallDetail } from "@/lib/voice/persist"

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
  const { callId } = await params
  const detail = await getCallDetail(callId)
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
  return NextResponse.json({
    status: "mock_handoff_queued",
    callId,
    companyId: detail.call.companyId,
    reason: body.reason,
  })
}

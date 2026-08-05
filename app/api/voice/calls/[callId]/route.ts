import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/api-auth"
import { getCallDetail } from "@/lib/voice/persist"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ callId: string }> },
) {
  const { ctx, response } = await authenticateRequest()
  if (response) return response

  const { callId } = await params
  const detail = await getCallDetail(callId, ctx.companyId)
  if (!detail) {
    return NextResponse.json({ error: "Звонок не найден" }, { status: 404 })
  }
  return NextResponse.json(detail)
}

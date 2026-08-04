import { NextResponse } from "next/server"
import { getCallDetail } from "@/lib/voice/persist"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ callId: string }> },
) {
  const { callId } = await params
  const detail = await getCallDetail(callId)
  if (!detail) {
    return NextResponse.json({ error: "Звонок не найден" }, { status: 404 })
  }
  return NextResponse.json(detail)
}

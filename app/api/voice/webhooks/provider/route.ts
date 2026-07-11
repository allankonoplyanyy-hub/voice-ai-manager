import { NextResponse } from "next/server"
import { getCall, processWebhook } from "@/lib/voice/store"
import { isTerminal } from "@/lib/voice/state-machine"

// Mock-webhook провайдера телефонии.
// Гарантии: идемпотентность (повторный webhook не создаёт дубль),
// completed call не обрабатывается повторно.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const idempotencyKey = body?.idempotencyKey as string | undefined
  const callId = body?.callId as string | undefined

  if (!idempotencyKey) {
    return NextResponse.json(
      { error: "idempotencyKey обязателен" },
      { status: 400 },
    )
  }

  const { duplicate } = processWebhook(idempotencyKey)
  if (duplicate) {
    return NextResponse.json({ status: "duplicate_ignored", idempotencyKey })
  }

  if (callId) {
    const call = getCall(callId)
    if (call && isTerminal(call.state)) {
      return NextResponse.json({
        status: "already_terminal",
        callId,
        state: call.state,
      })
    }
  }

  return NextResponse.json({ status: "accepted_mock", idempotencyKey })
}

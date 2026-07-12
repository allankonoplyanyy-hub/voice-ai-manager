import { NextResponse } from "next/server"
import { verifyWebhook } from "@/lib/voice/security"
import { isTerminal } from "@/lib/voice/state-machine"
import { getCall, processWebhook } from "@/lib/voice/store"

// Webhook провайдера телефонии. Гарантии:
// 1. HMAC-SHA256 подпись: заголовки x-voice-timestamp + x-voice-signature.
//    signature = HMAC(secret, `${timestamp}.${rawBody}`).
// 2. Replay protection: timestamp вне окна ±5 минут отклоняется (401).
// 3. Идемпотентность: повторный idempotencyKey не создаёт дубль.
// 4. Терминальный звонок неизменяем: события по нему игнорируются.
//
// Demo-режим: секрет по умолчанию demo-secret-not-for-production,
// в live обязателен VOICE_WEBHOOK_SECRET.

export async function POST(request: Request) {
  const rawBody = await request.text()

  const verification = verifyWebhook(rawBody, {
    timestamp: request.headers.get("x-voice-timestamp") ?? undefined,
    signature: request.headers.get("x-voice-signature") ?? undefined,
  })
  if (!verification.ok) {
    return NextResponse.json({ error: verification.error }, { status: verification.status })
  }

  let body: Record<string, unknown> | null = null
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }

  const idempotencyKey = body?.idempotencyKey as string | undefined
  const callId = body?.callId as string | undefined

  if (!idempotencyKey) {
    return NextResponse.json({ error: "idempotency_key_required" }, { status: 400 })
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

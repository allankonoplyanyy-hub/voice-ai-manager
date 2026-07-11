import { NextResponse } from "next/server"
import { getCall, getStore } from "@/lib/voice/store"
import type { FollowUp, FollowUpChannel } from "@/lib/voice/types"

const CHANNELS: FollowUpChannel[] = ["sms", "telegram", "whatsapp", "email"]

// Создание follow-up. В demo-режиме наружу ничего не отправляется —
// создаётся mock-событие со статусом sent_mock.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ callId: string }> },
) {
  const { callId } = await params
  const call = getCall(callId)
  if (!call) {
    return NextResponse.json({ error: "Звонок не найден" }, { status: 404 })
  }
  const body = await request.json().catch(() => null)
  const channel = body?.channel as FollowUpChannel | undefined
  if (!channel || !CHANNELS.includes(channel) || !body?.text) {
    return NextResponse.json(
      { error: "channel (sms|telegram|whatsapp|email) и text обязательны" },
      { status: 400 },
    )
  }
  const followUp: FollowUp = {
    id: `fu-manual-${Date.now().toString(36)}`,
    companyId: call.companyId,
    callId,
    channel,
    recipient: call.clientPhone,
    text: body.text,
    status: "sent_mock",
    reason: body.reason ?? "Ручной follow-up из Admin UI",
    errorReason: null,
    createdAt: new Date().toISOString(),
  }
  getStore().followUps.set(followUp.id, followUp)
  call.followUpIds.push(followUp.id)
  return NextResponse.json({ followUp }, { status: 201 })
}

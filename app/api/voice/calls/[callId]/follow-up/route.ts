import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { voiceFollowUps } from "@/lib/db/schema"
import { getCallDetail } from "@/lib/voice/persist"
import type { FollowUpChannel } from "@/lib/voice/types"

const CHANNELS: FollowUpChannel[] = ["sms", "telegram", "whatsapp", "email"]

// Создание follow-up. В demo-режиме наружу ничего не отправляется —
// запись сохраняется со статусом sent_mock.
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
  const channel = body?.channel as FollowUpChannel | undefined
  if (!channel || !CHANNELS.includes(channel) || !body?.text) {
    return NextResponse.json(
      { error: "channel (sms|telegram|whatsapp|email) и text обязательны" },
      { status: 400 },
    )
  }

  const id = `fu_${randomUUID()}`
  const createdAt = new Date()
  await db.insert(voiceFollowUps).values({
    id,
    companyId: detail.call.companyId,
    callId,
    channel,
    recipient: detail.call.clientPhone,
    text: body.text,
    status: "sent_mock",
    reason: body.reason ?? "Ручной follow-up из Admin UI",
    createdAt,
  })

  return NextResponse.json(
    {
      followUp: {
        id,
        companyId: detail.call.companyId,
        callId,
        channel,
        recipient: detail.call.clientPhone,
        text: body.text,
        status: "sent_mock",
        reason: body.reason ?? "Ручной follow-up из Admin UI",
        errorReason: null,
        createdAt: createdAt.toISOString(),
      },
    },
    { status: 201 },
  )
}

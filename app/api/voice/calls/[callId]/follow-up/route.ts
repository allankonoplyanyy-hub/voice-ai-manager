import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/api-auth"
import { db } from "@/lib/db"
import { voiceFollowUps } from "@/lib/db/schema"
import { getCallDetail } from "@/lib/voice/persist"
import { writeAudit } from "@/lib/voice/repo"
import type { FollowUpChannel } from "@/lib/voice/types"

const CHANNELS: FollowUpChannel[] = ["sms", "telegram", "whatsapp", "email"]

// Создание follow-up. В demo-режиме наружу ничего не отправляется —
// запись сохраняется со статусом sent_mock.
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

  // Сообщение уходит клиенту от имени компании. В журнал пишется канал и
  // получатель, но не текст: он может содержать личные данные, а журнал хранится
  // дольше самой переписки.
  await writeAudit({
    companyId: ctx.companyId,
    actor: ctx.email,
    action: "follow_up.created",
    targetType: "call",
    targetId: callId,
    outcome: "ok",
    detail: { followUpId: id, channel, recipient: detail.call.clientPhone },
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

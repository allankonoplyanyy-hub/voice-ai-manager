import { NextResponse, type NextRequest } from "next/server"

import { getCompany, writeAudit } from "@/lib/voice/repo"
import { outboxStats, replayDeadLetter } from "@/lib/voice/outbox"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Состояние очереди события по компании: сколько ждёт, сколько застряло. */
export async function GET(_request: NextRequest, context: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await context.params

  const company = await getCompany(companyId)
  if (!company) {
    return NextResponse.json({ error: "company_not_found" }, { status: 404 })
  }

  const stats = await outboxStats(companyId)
  return NextResponse.json({ companyId, ...stats })
}

/** Возвращает события из dead-letter в очередь после устранения причины сбоя. */
export async function POST(request: NextRequest, context: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await context.params

  const company = await getCompany(companyId)
  if (!company) {
    return NextResponse.json({ error: "company_not_found" }, { status: 404 })
  }

  let eventIds: string[] | undefined
  try {
    const body = (await request.json()) as { eventIds?: unknown }
    if (Array.isArray(body.eventIds)) {
      // Пропускаем только строки: посторонние типы попали бы в SQL-параметры.
      eventIds = body.eventIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    }
  } catch {
    // Пустое тело — законный запрос «поднять всё».
  }

  const replayed = await replayDeadLetter(companyId, eventIds)

  await writeAudit({
    companyId,
    actor: "operator",
    action: "outbox.replay_dead_letter",
    targetType: "outbox",
    targetId: eventIds?.join(",").slice(0, 200) ?? "all",
    outcome: "ok",
    detail: { replayed },
  })

  return NextResponse.json({ companyId, replayed })
}

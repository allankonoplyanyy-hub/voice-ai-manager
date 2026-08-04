import { NextResponse, type NextRequest } from "next/server"

import { getCompany } from "@/lib/voice/repo"
import { drainOutbox, reclaimStaleEvents, type DeliveryTarget } from "@/lib/voice/outbox"
import { safeCompare } from "@/lib/voice/security"
import { safeLog } from "@/lib/voice/redaction"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Максимум событий за один проход, чтобы запрос не выходил за таймаут функции. */
const BATCH_LIMIT = 25

/**
 * Проход воркера доставки outbox.
 *
 * Защищён отдельным токеном: маршрут инициирует исходящие HTTP-запросы, поэтому
 * открытый доступ позволил бы постороннему гонять доставку и расходовать попытки.
 * Принимается штатный `CRON_SECRET` (его подставляет Vercel Cron) либо
 * `VOICE_CRON_SECRET` для ручных вызовов.
 */
async function runDrain(request: NextRequest) {
  const expected = process.env.CRON_SECRET ?? process.env.VOICE_CRON_SECRET
  if (!expected) {
    // Fail closed: без токена маршрут не работает вообще, а не «работает без защиты».
    return NextResponse.json(
      { error: "CRON_SECRET не настроен", hint: "задайте CRON_SECRET или VOICE_CRON_SECRET" },
      { status: 503 },
    )
  }

  const presented = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? ""
  if (!safeCompare(presented, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const secret = process.env.VOICE_CONTROL_CENTER_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: "VOICE_CONTROL_CENTER_SECRET не настроен", hint: "без секрета события нельзя подписать" },
      { status: 503 },
    )
  }

  const reclaimed = await reclaimStaleEvents()

  const resolveTarget = async (companyId: string): Promise<DeliveryTarget | null> => {
    const company = await getCompany(companyId)
    // Неактивной компании не доставляем: отключение должно останавливать поток.
    if (!company?.webhookUrl || !company.active) return null
    return { url: company.webhookUrl, secret }
  }

  const stats = await drainOutbox(resolveTarget, BATCH_LIMIT)
  safeLog("outbox.drain", { ...stats, reclaimed })

  return NextResponse.json({ ...stats, reclaimed })
}

/** Vercel Cron вызывает расписания только методом GET. */
export async function GET(request: NextRequest) {
  return runDrain(request)
}

/** Ручной запуск прохода — например, после починки упавшего вебхука. */
export async function POST(request: NextRequest) {
  return runDrain(request)
}

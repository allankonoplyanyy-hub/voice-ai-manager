import { NextResponse } from "next/server"
import { runScenario } from "@/lib/voice/engine"
import { getScenario } from "@/lib/voice/scenarios"
import { getStore, persistRun } from "@/lib/voice/store"

// Запускает demo-сценарий «вживую»: прогоняет через движок и сохраняет
// звонок, лид, запись, follow-up и события в store.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { scenarioId?: string } | null
  if (!body?.scenarioId) {
    return NextResponse.json({ error: "scenarioId обязателен" }, { status: 400 })
  }
  const scenario = getScenario(body.scenarioId)
  if (!scenario) {
    return NextResponse.json({ error: "Сценарий не найден" }, { status: 404 })
  }

  const runId = `live-${Date.now()}`
  const result = runScenario(scenario, new Date(), runId)
  persistRun(getStore(), result)

  return NextResponse.json({
    callId: result.call.callId,
    outcome: result.call.outcome,
    leadId: result.lead?.id ?? null,
    bookingId: result.booking?.id ?? null,
    handoff: result.call.handoff !== null,
    followUps: result.followUps.length,
    events: result.events.length,
  })
}

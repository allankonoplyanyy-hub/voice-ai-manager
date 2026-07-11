import { NextResponse } from "next/server"
import { runScenario } from "@/lib/voice/engine"
import { getScenario } from "@/lib/voice/scenarios"
import { getAllCalls, getStore, persistRun } from "@/lib/voice/store"

export async function GET() {
  return NextResponse.json({ calls: getAllCalls() })
}

// Запуск demo-звонка по сценарию. Внешние API не вызываются.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const scenarioId = body?.scenarioId as string | undefined
  if (!scenarioId) {
    return NextResponse.json({ error: "scenarioId обязателен" }, { status: 400 })
  }
  const scenario = getScenario(scenarioId)
  if (!scenario) {
    return NextResponse.json({ error: "Сценарий не найден" }, { status: 404 })
  }
  const runId = `run-${Date.now().toString(36)}`
  const result = runScenario(scenario, new Date(), runId)
  persistRun(getStore(), result)
  return NextResponse.json(
    {
      call: result.call,
      lead: result.lead,
      booking: result.booking,
      followUps: result.followUps,
      events: result.events,
    },
    { status: 201 },
  )
}

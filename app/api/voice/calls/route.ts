import { NextResponse } from "next/server"
import { runScenario } from "@/lib/voice/engine"
import { ensureCompanies, ensureSeeded, listAllCalls, persistRun } from "@/lib/voice/persist"
import { getScenario } from "@/lib/voice/scenarios"

export async function GET() {
  await ensureSeeded()
  return NextResponse.json({ calls: await listAllCalls() })
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
  // Компания-арендатор должна существовать до записи звонка: outbox определяет
  // адрес доставки именно по ней.
  await ensureCompanies()
  const runId = `run-${Date.now().toString(36)}`
  const result = runScenario(scenario, new Date(), runId)
  await persistRun(result)
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

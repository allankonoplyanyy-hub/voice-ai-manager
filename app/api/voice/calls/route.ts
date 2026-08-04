import { NextResponse } from "next/server"
import { runScenario } from "@/lib/voice/engine"
import { TurnTimer, checkBudgets } from "@/lib/voice/latency"
import { ensureCompanies, ensureSeeded, listAllCalls, persistRun } from "@/lib/voice/persist"
import { safeLog } from "@/lib/voice/redaction"
import { effectiveMode } from "@/lib/voice/runtime"
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

  // Гейт режима: в disabled система не принимает ничего. Проверка стоит до
  // любой записи, чтобы отключение действительно останавливало поток.
  const mode = effectiveMode()
  if (mode === "disabled") {
    return NextResponse.json(
      { error: "Режим disabled: приём звонков остановлен", mode },
      { status: 503 },
    )
  }

  // Компания-арендатор должна существовать до записи звонка: outbox определяет
  // адрес доставки именно по ней.
  await ensureCompanies()
  const runId = `run-${Date.now().toString(36)}`
  const result = runScenario(scenario, new Date(), runId)

  // Замеряем реальную латентность обработки, а не смоделированные тайминги
  // сценария: сеть до Postgres и запись в outbox — то, что действительно
  // способно деградировать в проде.
  const timer = new TurnTimer({
    callId: result.call.callId,
    companyId: result.call.companyId,
    turnIndex: 0,
    mode,
  })
  await timer.measure("booking_provider", () => persistRun(result))
  timer.mark("first_audio_delivered")
  const metrics = timer.end()
  const violations = checkBudgets(metrics)
  if (violations.length > 0) {
    safeLog("latency.budget_exceeded", {
      callId: metrics.callId,
      mode,
      violations: violations.map((v) => `${v.stage}:+${v.overByMs}ms`),
    })
  }

  return NextResponse.json(
    {
      call: result.call,
      lead: result.lead,
      booking: result.booking,
      followUps: result.followUps,
      events: result.events,
      mode,
      latencyMs: metrics.fullTurnMs,
    },
    { status: 201 },
  )
}

import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/api-auth"
import { writeAudit } from "@/lib/voice/repo"
import { runScenario } from "@/lib/voice/engine"
import { ensureCompanies, persistRun } from "@/lib/voice/persist"
import { getScenario } from "@/lib/voice/scenarios"

// Запускает demo-сценарий «вживую»: прогоняет через движок и сохраняет
// звонок, лид, запись, follow-up в БД, а события — в outbox.
export async function POST(request: Request) {
  // Запуск пишет звонки в базу и ставит события в очередь доставки — анонимно
  // такое допускать нельзя.
  const { ctx, response } = await authenticateRequest()
  if (response) return response

  const body = (await request.json().catch(() => null)) as { scenarioId?: string } | null
  if (!body?.scenarioId) {
    return NextResponse.json({ error: "scenarioId обязателен" }, { status: 400 })
  }
  const scenario = getScenario(body.scenarioId)

  // Сценарий несёт свой companyId, и раньше он попадал в базу как есть: любой
  // вошедший мог записать звонок в чужую компанию, просто указав её сценарий.
  // Теперь чужой сценарий неотличим от несуществующего — по коду ответа нельзя
  // выяснить, какие компании есть в системе.
  if (!scenario || scenario.companyId !== ctx.companyId) {
    await writeAudit({
      companyId: ctx.companyId,
      actor: ctx.email,
      action: "demo.run",
      targetType: "scenario",
      targetId: body.scenarioId,
      outcome: "denied",
      detail: { reason: scenario ? "scenario_of_other_company" : "scenario_not_found" },
    })
    return NextResponse.json({ error: "Сценарий не найден" }, { status: 404 })
  }

  await ensureCompanies()
  const runId = `live-${Date.now()}`
  const result = runScenario(scenario, new Date(), runId)
  await persistRun(result)

  await writeAudit({
    companyId: ctx.companyId,
    actor: ctx.email,
    action: "demo.run",
    targetType: "call",
    targetId: result.call.callId,
    outcome: "ok",
    detail: { scenarioId: scenario.id, runId },
  })

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

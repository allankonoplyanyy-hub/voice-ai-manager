import { beforeEach, describe, expect, it, vi } from "vitest"
import { runScenario } from "@/lib/voice/engine"
import { getScenario, DEMO_SCENARIOS } from "@/lib/voice/scenarios"
import { assertTransition, canTransition, isTerminal } from "@/lib/voice/state-machine"

function run(id: string, options?: Parameters<typeof runScenario>[3]) {
  const scenario = getScenario(id)
  if (!scenario) throw new Error(`scenario not found: ${id}`)
  return runScenario(scenario, new Date("2026-07-01T09:00:00Z"), `test-${id}`, options)
}

describe("booking happy path", () => {
  it("создаёт лид, запись и follow-up, звонок завершается completed", () => {
    const result = run("school-enroll")
    expect(result.call.state).toBe("completed")
    expect(result.call.outcome).toBe("booking_created")
    expect(result.lead).not.toBeNull()
    expect(result.booking).not.toBeNull()
    expect(result.booking?.companyId).toBe("school-astana")
    expect(result.followUps.length).toBeGreaterThan(0)
    expect(result.call.consentGiven).toBe(true)
  })
})

describe("lead без записи", () => {
  it("realty-buy создаёт горячий лид без booking", () => {
    const result = run("realty-buy")
    expect(result.lead).not.toBeNull()
    expect(result.lead?.temperature).toBe("hot")
    expect(result.booking).toBeNull()
    expect(result.call.outcome).toBe("lead_created")
  })
})

describe("handoff", () => {
  it("агрессивный клиент передаётся менеджеру с причиной и резюме", () => {
    const result = run("angry-customer")
    expect(result.call.state).toBe("manager_handoff")
    expect(result.call.handoff).not.toBeNull()
    expect(result.call.handoff?.reason).toBe("aggression")
    expect(result.call.handoff?.reasonText.length).toBeGreaterThan(0)
    expect(isTerminal(result.call.state)).toBe(true)
  })
})

describe("state machine", () => {
  it("терминальное состояние неизменяемо", () => {
    expect(() => assertTransition("completed", "greeting")).toThrow()
    expect(() => assertTransition("manager_handoff", "consulting")).toThrow()
    expect(canTransition("completed", "follow_up")).toBe(false)
  })

  it("запрещает произвольные переходы", () => {
    expect(canTransition("received", "booking")).toBe(false)
    expect(canTransition("greeting", "lead_capture")).toBe(false)
  })

  it("все demo-сценарии проходят только по разрешённым переходам", () => {
    for (const s of DEMO_SCENARIOS) {
      expect(() => runScenario(s, new Date(), `smoke-${s.id}`)).not.toThrow()
    }
  })
})

describe("cost guard", () => {
  it("превышение лимита стоимости завершает звонок cost_limit_reached", () => {
    const result = run("school-enroll", { maxCallCostTenge: 10 })
    expect(result.call.state).toBe("cost_limit_reached")
    expect(result.call.outcome).toBe("failed")
    expect(isTerminal(result.call.state)).toBe(true)
  })

  it("достаточный лимит не влияет на звонок", () => {
    const result = run("school-enroll", { maxCallCostTenge: 100000 })
    expect(result.call.state).toBe("completed")
  })
})

describe("CRM failure — лид не теряется", () => {
  it("лид сохраняется локально со статусом pending_retry", () => {
    const result = run("crm-failure")
    expect(result.lead).not.toBeNull()
    expect(result.lead?.crmStatus).toBe("pending_retry")
    expect(result.lead?.crmExternalId).toBeNull()
    expect(result.call.errors.some((e) => e.system === "crm" && e.recovered)).toBe(true)
    // клиент получил запись несмотря на сбой CRM
    expect(result.booking).not.toBeNull()
    expect(result.call.state).toBe("completed")
  })
})

describe("Calendar failure — создаётся follow-up", () => {
  it("вместо записи создаётся заявка с follow-up, звонок завершается успешно", () => {
    const result = run("calendar-failure")
    expect(result.booking).toBeNull()
    expect(result.lead).not.toBeNull()
    expect(result.followUps.length).toBeGreaterThan(0)
    expect(result.call.errors.some((e) => e.system === "calendar" && e.recovered)).toBe(true)
    expect(result.call.state).toBe("completed")
  })
})

describe("Manager unavailable — заявка на обратный звонок", () => {
  it("клиент не теряется: лид + follow-up при недоступном менеджере", () => {
    const result = run("manager-unavailable")
    expect(result.lead).not.toBeNull()
    expect(result.followUps.length).toBeGreaterThan(0)
    expect(result.call.errors.some((e) => e.system === "provider" && e.recovered)).toBe(true)
    expect(result.call.state).toBe("completed")
  })
})

describe("demo mode — 0 внешних запросов", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("прогон всех сценариев не вызывает fetch", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    for (const s of DEMO_SCENARIOS) {
      runScenario(s, new Date(), `netcheck-${s.id}`)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

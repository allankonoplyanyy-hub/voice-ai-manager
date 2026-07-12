import { beforeEach, describe, expect, it } from "vitest"
import {
  getAllCalls,
  getCallsByCompany,
  getLeadsByCompany,
  getStore,
  processWebhook,
} from "@/lib/voice/store"
import { DEMO_TENANTS } from "@/lib/voice/tenants"
import { purgeExpiredTranscripts } from "@/lib/voice/retention"
import { checkCostGuard } from "@/lib/voice/cost-guard"

beforeEach(() => {
  // пересоздаём store между тестами
  globalThis.__voiceStore = undefined
})

describe("идемпотентность webhook", () => {
  it("дублирующий idempotencyKey не обрабатывается повторно", () => {
    expect(processWebhook("dup-key-1")).toEqual({ duplicate: false })
    expect(processWebhook("dup-key-1")).toEqual({ duplicate: true })
    expect(processWebhook("dup-key-2")).toEqual({ duplicate: false })
  })
})

describe("cross-tenant isolation", () => {
  it("выборка по компании не содержит чужих звонков", () => {
    for (const tenant of DEMO_TENANTS) {
      const calls = getCallsByCompany(tenant.companyId)
      expect(calls.every((c) => c.companyId === tenant.companyId)).toBe(true)
    }
  })

  it("выборка лидов по компании не содержит чужих лидов", () => {
    for (const tenant of DEMO_TENANTS) {
      const leads = getLeadsByCompany(tenant.companyId)
      expect(leads.every((l) => l.companyId === tenant.companyId)).toBe(true)
    }
  })

  it("сумма звонков по всем тенантам равна общему числу звонков", () => {
    const total = getAllCalls().length
    const sum = DEMO_TENANTS.reduce((acc, t) => acc + getCallsByCompany(t.companyId).length, 0)
    expect(sum).toBe(total)
    expect(total).toBeGreaterThan(0)
  })
})

describe("transcript retention", () => {
  it("транскрипты старше retention-окна очищаются, метаданные сохраняются", () => {
    const store = getStore()
    const calls = [...store.calls.values()]
    const now = Date.now()
    // окно 7 дней: seed содержит звонки старше
    const result = purgeExpiredTranscripts(calls, now, 7)
    expect(result.scanned).toBe(calls.length)
    expect(result.purged).toBeGreaterThan(0)
    for (const call of calls) {
      const ageDays = (now - Date.parse(call.startedAt)) / 86400_000
      if (ageDays > 7) {
        expect(call.transcript).toHaveLength(0)
        // метаданные не тронуты
        expect(call.outcome).toBeTruthy()
        expect(call.companyId).toBeTruthy()
      }
    }
  })
})

describe("cost guard (модуль)", () => {
  it("определяет превышение стоимости и длительности", () => {
    const tenant = { maxCallCostTenge: 100, maxCallDurationSec: 300 }
    expect(checkCostGuard({ costTenge: 101, durationSec: 10 }, tenant).exceeded).toBe(true)
    expect(checkCostGuard({ costTenge: 50, durationSec: 301 }, tenant).reason).toBe("duration")
    expect(checkCostGuard({ costTenge: 50, durationSec: 100 }, tenant).exceeded).toBe(false)
  })
})

import { describe, expect, it } from "vitest"
import {
  CapabilityDeniedError,
  type PreflightInput,
  assertCapability,
  capabilitiesOf,
  isNumberAllowed,
  isOperatingMode,
  modeAllows,
  runPreflight,
} from "@/lib/voice/modes"

const fullyConfigured: PreflightInput = {
  requestedMode: "live",
  hasDatabase: true,
  hasTelephony: true,
  hasStt: true,
  hasLlm: true,
  hasTts: true,
  hasCrm: true,
  hasCalendar: true,
  hasMessaging: true,
  hasWebhookSecret: true,
  hasKnowledgeBase: true,
  testAllowlistSize: 2,
}

describe("возможности режимов", () => {
  it("demo не даёт ни одной внешней записи", () => {
    expect(capabilitiesOf("demo")).toHaveLength(0)
    expect(modeAllows("demo", "accept_real_calls")).toBe(false)
    expect(modeAllows("demo", "write_crm")).toBe(false)
  })

  it("disabled не принимает звонки", () => {
    expect(modeAllows("disabled", "accept_real_calls")).toBe(false)
  })

  it("test принимает звонки, но не пишет в CRM и календарь", () => {
    expect(modeAllows("test", "accept_real_calls")).toBe(true)
    expect(modeAllows("test", "write_crm")).toBe(false)
    expect(modeAllows("test", "write_calendar")).toBe(false)
    expect(modeAllows("test", "store_recordings")).toBe(false)
  })

  it("degraded принимает звонки, но не пишет наружу", () => {
    expect(modeAllows("degraded", "accept_real_calls")).toBe(true)
    expect(modeAllows("degraded", "write_crm")).toBe(false)
    expect(modeAllows("degraded", "send_messaging")).toBe(false)
  })

  it("live разрешает всё", () => {
    for (const cap of capabilitiesOf("live")) expect(modeAllows("live", cap)).toBe(true)
    expect(modeAllows("live", "write_crm")).toBe(true)
  })

  it("assertCapability бросает исключение с указанием режима", () => {
    expect(() => assertCapability("demo", "write_crm")).toThrow(CapabilityDeniedError)
    expect(() => assertCapability("live", "write_crm")).not.toThrow()
  })

  it("распознаёт валидные режимы", () => {
    expect(isOperatingMode("live")).toBe(true)
    expect(isOperatingMode("production")).toBe(false)
  })
})

describe("preflight gate", () => {
  it("полностью настроенный live проходит", () => {
    const report = runPreflight(fullyConfigured)
    expect(report.ready).toBe(true)
    expect(report.effectiveMode).toBe("live")
    expect(report.blockingReasons).toHaveLength(0)
  })

  it("live без CRM понижается до degraded, а не падает", () => {
    const report = runPreflight({ ...fullyConfigured, hasCrm: false })
    expect(report.ready).toBe(false)
    expect(report.effectiveMode).toBe("degraded")
    expect(report.blockingReasons.length).toBeGreaterThan(0)
  })

  it("live без календаря понижается до degraded", () => {
    const report = runPreflight({ ...fullyConfigured, hasCalendar: false })
    expect(report.effectiveMode).toBe("degraded")
  })

  it("отсутствие телефонии понижает до demo", () => {
    const report = runPreflight({ ...fullyConfigured, hasTelephony: false })
    expect(report.effectiveMode).toBe("demo")
  })

  it("отсутствие секрета вебхуков понижает до demo", () => {
    const report = runPreflight({ ...fullyConfigured, hasWebhookSecret: false })
    expect(report.effectiveMode).toBe("demo")
  })

  it("отсутствие базы знаний понижает до demo", () => {
    const report = runPreflight({ ...fullyConfigured, hasKnowledgeBase: false })
    expect(report.effectiveMode).toBe("demo")
  })

  it("отсутствие базы данных понижает до demo", () => {
    const report = runPreflight({ ...fullyConfigured, hasDatabase: false })
    expect(report.effectiveMode).toBe("demo")
  })

  it("test-режим требует непустой allowlist", () => {
    const report = runPreflight({ ...fullyConfigured, requestedMode: "test", testAllowlistSize: 0 })
    expect(report.ready).toBe(false)
    expect(report.effectiveMode).toBe("demo")
  })

  it("demo не требует внешних провайдеров", () => {
    const report = runPreflight({
      requestedMode: "demo",
      hasDatabase: true,
      hasTelephony: false,
      hasStt: false,
      hasLlm: false,
      hasTts: false,
      hasCrm: false,
      hasCalendar: false,
      hasMessaging: false,
      hasWebhookSecret: false,
      hasKnowledgeBase: false,
      testAllowlistSize: 0,
    })
    expect(report.ready).toBe(true)
    expect(report.effectiveMode).toBe("demo")
  })

  it("отсутствие messaging не блокирует режим", () => {
    const report = runPreflight({ ...fullyConfigured, hasMessaging: false })
    expect(report.ready).toBe(true)
    expect(report.effectiveMode).toBe("live")
  })

  it("отчёт перечисляет все проверки с их обязательностью", () => {
    const report = runPreflight(fullyConfigured)
    expect(report.checks.length).toBeGreaterThanOrEqual(11)
    expect(report.checks.every((c) => typeof c.detail === "string" && c.detail.length > 0)).toBe(true)
  })
})

describe("allowlist тестовых номеров", () => {
  it("в test-режиме пропускает только разрешённые номера", () => {
    const allow = ["+7 777 111 22 33"]
    expect(isNumberAllowed("test", "+77771112233", allow)).toBe(true)
    expect(isNumberAllowed("test", "+77770000000", allow)).toBe(false)
  })

  it("нормализует форматирование номера при сверке", () => {
    expect(isNumberAllowed("test", "+7 (777) 111-22-33", ["+77771112233"])).toBe(true)
  })

  it("вне test-режима allowlist не применяется", () => {
    expect(isNumberAllowed("live", "+77770000000", [])).toBe(true)
  })
})

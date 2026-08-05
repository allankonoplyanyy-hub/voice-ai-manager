import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { currentPreflight, effectiveMode, requestedMode, testAllowlist } from "@/lib/voice/runtime"

// Модуль читает process.env напрямую, поэтому окружение сохраняется и
// восстанавливается вокруг каждого теста: иначе тесты влияли бы друг на друга
// и на остальной набор.
const KEYS = [
  "VOICE_MODE",
  "VOICE_TEST_ALLOWLIST",
  "DATABASE_URL",
  "POSTGRES_URL",
  "VOICE_TELEPHONY_PROVIDER",
  "VOICE_STT_PROVIDER",
  "VOICE_LLM_PROVIDER",
  "AI_GATEWAY_API_KEY",
  "VOICE_TTS_PROVIDER",
  "VOICE_CRM_PROVIDER",
  "VOICE_CALENDAR_PROVIDER",
  "VOICE_MESSAGING_PROVIDER",
  "VOICE_CONTROL_CENTER_SECRET",
  "VOICE_KNOWLEDGE_VERSION",
] as const

let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = {}
  for (const key of KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

/** Полный набор провайдеров — база для проверок понижения режима. */
function setFullPipeline() {
  process.env.DATABASE_URL = "postgres://x"
  process.env.VOICE_TELEPHONY_PROVIDER = "mock"
  process.env.VOICE_STT_PROVIDER = "mock"
  process.env.VOICE_LLM_PROVIDER = "mock"
  process.env.VOICE_TTS_PROVIDER = "mock"
  process.env.VOICE_CONTROL_CENTER_SECRET = "s".repeat(32)
  process.env.VOICE_KNOWLEDGE_VERSION = "v1"
  process.env.VOICE_CRM_PROVIDER = "mock"
  process.env.VOICE_CALENDAR_PROVIDER = "mock"
}

describe("requestedMode", () => {
  it("без переменной по умолчанию demo", () => {
    expect(requestedMode()).toBe("demo")
  })

  it("распознаёт допустимые режимы", () => {
    for (const mode of ["test", "live", "degraded", "disabled"] as const) {
      process.env.VOICE_MODE = mode
      expect(requestedMode()).toBe(mode)
    }
  })

  it("мусорное значение не включает live, а падает в demo", () => {
    process.env.VOICE_MODE = "LIVE!!"
    // Безопасное значение по умолчанию: опечатка не должна открывать
    // приём реальных звонков.
    expect(requestedMode()).toBe("demo")
  })

  it("пустая строка трактуется как demo", () => {
    process.env.VOICE_MODE = "   "
    expect(requestedMode()).toBe("demo")
  })
})

describe("testAllowlist", () => {
  it("без переменной список пуст", () => {
    expect(testAllowlist()).toEqual([])
  })

  it("разбирает список и отбрасывает пустые элементы", () => {
    process.env.VOICE_TEST_ALLOWLIST = "+7 701 111 11 11, ,+7 702 222 22 22,"
    expect(testAllowlist()).toEqual(["+7 701 111 11 11", "+7 702 222 22 22"])
  })
})

describe("currentPreflight — понижение режима", () => {
  it("demo готов без провайдеров, если есть БД", () => {
    process.env.DATABASE_URL = "postgres://x"
    const report = currentPreflight()
    expect(report.effectiveMode).toBe("demo")
    expect(report.ready).toBe(true)
  })

  it("без БД даже demo не готов", () => {
    const report = currentPreflight()
    expect(report.ready).toBe(false)
    expect(report.blockingReasons.length).toBeGreaterThan(0)
  })

  it("live без медиа-тракта понижается до demo", () => {
    process.env.DATABASE_URL = "postgres://x"
    process.env.VOICE_MODE = "live"
    const report = currentPreflight()
    expect(report.requestedMode).toBe("live")
    expect(report.effectiveMode).toBe("demo")
    expect(report.ready).toBe(false)
  })

  it("live с полным трактом остаётся live", () => {
    setFullPipeline()
    process.env.VOICE_MODE = "live"
    const report = currentPreflight()
    expect(report.effectiveMode).toBe("live")
    expect(report.ready).toBe(true)
  })

  it("live без CRM понижается до degraded, а не до demo", () => {
    setFullPipeline()
    delete process.env.VOICE_CRM_PROVIDER
    process.env.VOICE_MODE = "live"
    const report = currentPreflight()
    // Тракт цел — звонки принимать можно, отключаются только внешние записи.
    expect(report.effectiveMode).toBe("degraded")
  })

  it("test без allowlist понижается до demo", () => {
    setFullPipeline()
    process.env.VOICE_MODE = "test"
    const report = currentPreflight()
    expect(report.effectiveMode).toBe("demo")
  })

  it("test с allowlist готов", () => {
    setFullPipeline()
    process.env.VOICE_MODE = "test"
    process.env.VOICE_TEST_ALLOWLIST = "+7 701 111 11 11"
    expect(currentPreflight().ready).toBe(true)
  })

  it("AI_GATEWAY_API_KEY считается настроенным LLM", () => {
    setFullPipeline()
    delete process.env.VOICE_LLM_PROVIDER
    process.env.AI_GATEWAY_API_KEY = "key"
    process.env.VOICE_MODE = "live"
    expect(currentPreflight().effectiveMode).toBe("live")
  })

  it("POSTGRES_URL заменяет DATABASE_URL", () => {
    delete process.env.DATABASE_URL
    process.env.POSTGRES_URL = "postgres://x"
    expect(currentPreflight().ready).toBe(true)
  })

  it("disabled остаётся disabled при полном тракте", () => {
    setFullPipeline()
    process.env.VOICE_MODE = "disabled"
    // Отключение — осознанное решение оператора, preflight не должен его отменять.
    expect(effectiveMode()).toBe("disabled")
  })
})

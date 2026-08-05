import { describe, expect, it } from "vitest"
import { FULL_TURN_BUDGET_MS, LATENCY_BUDGET_MS, TurnTimer, checkBudgets, percentiles } from "@/lib/voice/latency"
import { maskName, maskPhone, redactObject, redactText } from "@/lib/voice/redaction"

/** Управляемые часы — измерения не должны зависеть от реального времени. */
function fakeClock(start = 0) {
  let now = start
  return { clock: () => now, advance: (ms: number) => (now += ms) }
}

describe("TurnTimer", () => {
  it("измеряет стадии от единой точки t0", () => {
    const { clock, advance } = fakeClock()
    const timer = new TurnTimer({ callId: "c1", companyId: "co1", turnIndex: 0, mode: "test", clock })
    advance(120)
    expect(timer.mark("vad_end")).toBe(120)
    advance(300)
    expect(timer.mark("stt_final")).toBe(420)
    advance(500)
    expect(timer.mark("first_audio_delivered")).toBe(920)
  })

  it("сохраняет первую отметку стадии при повторном вызове", () => {
    const { clock, advance } = fakeClock()
    const timer = new TurnTimer({ callId: "c1", companyId: "co1", turnIndex: 0, mode: "test", clock })
    advance(100)
    timer.mark("stt_final")
    advance(900)
    timer.mark("stt_final")
    expect(timer.end().stages.stt_final).toBe(100)
  })

  it("fullTurnMs берётся из момента первого аудио", () => {
    const { clock, advance } = fakeClock()
    const timer = new TurnTimer({ callId: "c1", companyId: "co1", turnIndex: 0, mode: "test", clock })
    advance(1400)
    timer.mark("first_audio_delivered")
    advance(5000)
    expect(timer.end().fullTurnMs).toBe(1400)
  })

  it("measure отмечает стадию даже при исключении", async () => {
    const { clock, advance } = fakeClock()
    const timer = new TurnTimer({ callId: "c1", companyId: "co1", turnIndex: 0, mode: "test", clock })
    await expect(
      timer.measure("llm_complete", async () => {
        advance(250)
        throw new Error("сбой LLM")
      }),
    ).rejects.toThrow("сбой LLM")
    expect(timer.end().stages.llm_complete).toBe(250)
  })

  it("переносит флаги прерывания в метрики", () => {
    const timer = new TurnTimer({ callId: "c1", companyId: "co1", turnIndex: 3, mode: "live" })
    timer.interrupted = true
    timer.interruptionHandled = true
    timer.fallbackUsed = true
    const metrics = timer.end()
    expect(metrics).toMatchObject({ interrupted: true, interruptionHandled: true, fallbackUsed: true, turnIndex: 3 })
  })
})

describe("бюджеты латентности", () => {
  it("не сообщает о нарушениях, когда всё в пределах", () => {
    const violations = checkBudgets({
      callId: "c",
      companyId: "co",
      turnIndex: 0,
      mode: "test",
      stages: { stt_final: LATENCY_BUDGET_MS.stt_final - 100 },
      fullTurnMs: FULL_TURN_BUDGET_MS - 100,
      interrupted: false,
      interruptionHandled: false,
      emptyTranscript: false,
      fallbackUsed: false,
    })
    expect(violations).toHaveLength(0)
  })

  it("находит превышение по конкретной стадии", () => {
    const violations = checkBudgets({
      callId: "c",
      companyId: "co",
      turnIndex: 0,
      mode: "test",
      stages: { llm_first_token: LATENCY_BUDGET_MS.llm_first_token + 250 },
      interrupted: false,
      interruptionHandled: false,
      emptyTranscript: false,
      fallbackUsed: false,
    })
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ stage: "llm_first_token", overByMs: 250 })
  })

  it("отдельно сообщает о превышении полного турна", () => {
    const violations = checkBudgets({
      callId: "c",
      companyId: "co",
      turnIndex: 0,
      mode: "test",
      stages: {},
      fullTurnMs: FULL_TURN_BUDGET_MS + 500,
      interrupted: false,
      interruptionHandled: false,
      emptyTranscript: false,
      fallbackUsed: false,
    })
    expect(violations.some((v) => v.stage === "full_turn" && v.overByMs === 500)).toBe(true)
  })
})

describe("перцентили", () => {
  it("возвращает нули для пустого набора", () => {
    expect(percentiles([])).toEqual({ count: 0, p50: 0, p95: 0, p99: 0, max: 0 })
  })

  it("считает p50/p95/max", () => {
    const result = percentiles(Array.from({ length: 100 }, (_, i) => i + 1))
    expect(result.count).toBe(100)
    expect(result.p50).toBe(50)
    expect(result.p95).toBe(95)
    expect(result.max).toBe(100)
  })

  it("игнорирует нечисловые значения", () => {
    expect(percentiles([10, Number.NaN, 20]).count).toBe(2)
  })
})

describe("редакция PII", () => {
  it("маскирует телефон, оставляя последние 2 цифры", () => {
    const masked = maskPhone("+7 777 123 45 67")
    expect(masked).not.toContain("7771234")
    expect(masked.endsWith("67")).toBe(true)
  })

  it("маскирует имя до первой буквы, сохраняя длину слов", () => {
    // "Айгуль" = 6 симв. -> А + 5 звёзд; "Смагулова" = 9 симв. -> С + 8 звёзд
    expect(maskName("Айгуль Смагулова")).toBe("А***** С********")
  })

  it("не пропускает исходное имя в замаскированный результат", () => {
    const masked = maskName("Айгуль Смагулова")
    expect(masked).not.toContain("йгуль")
    expect(masked).not.toContain("магулова")
  })

  it("вырезает номера карт и ИИН из свободного текста", () => {
    const text = redactText("карта 4111 1111 1111 1111 и ИИН 123456789012")
    expect(text).toContain("[card]")
    expect(text).toContain("[id]")
    expect(text).not.toContain("4111111111111111")
  })

  it("маскирует email, сохраняя домен", () => {
    const text = redactText("напишите на client@example.com")
    expect(text).toContain("@example.com")
    expect(text).not.toContain("client@")
  })

  it("полностью удаляет секреты из объектов", () => {
    const result = redactObject({
      webhookSecret: "whsec_очень_секретно",
      apiKey: "sk-12345",
      authToken: "bearer-xyz",
    }) as Record<string, string>
    expect(JSON.stringify(result)).not.toContain("whsec_очень_секретно")
    expect(JSON.stringify(result)).not.toContain("sk-12345")
    expect(result.webhookSecret).toBe("[redacted]")
  })

  it("маскирует телефон и имя во вложенных структурах", () => {
    const result = redactObject({
      call: { clientPhone: "+77771234567", clientName: "Айгуль", nested: { phone: "+77779998877" } },
    })
    const json = JSON.stringify(result)
    expect(json).not.toContain("77771234567")
    expect(json).not.toContain("77779998877")
    expect(json).not.toContain("Айгуль")
  })

  it("не разворачивает бесконечно вложенные объекты", () => {
    const deep: Record<string, unknown> = {}
    let cursor = deep
    for (let i = 0; i < 20; i++) {
      cursor.next = {}
      cursor = cursor.next as Record<string, unknown>
    }
    expect(() => redactObject(deep)).not.toThrow()
    expect(JSON.stringify(redactObject(deep))).toContain("depth-limit")
  })
})

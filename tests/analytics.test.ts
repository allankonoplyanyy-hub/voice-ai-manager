import { describe, expect, it } from "vitest"

import { callsPerDay, computeMetrics } from "@/lib/voice/analytics"
import type { CallOutcome, CallState, FollowUp, VoiceCall } from "@/lib/voice/types"

// Чистые вычисления, поэтому база не нужна. `now` во всех тестах фиксирован:
// иначе набор «за сегодня» менялся бы от времени запуска.
const NOW = new Date("2026-08-05T12:00:00.000Z")

function call(overrides: Partial<VoiceCall> & { callId: string }): VoiceCall {
  return {
    companyId: "co",
    providerCallId: `prov-${overrides.callId}`,
    clientName: "Клиент",
    clientPhone: "+7 700 000 00 00",
    direction: "inbound",
    startedAt: "2026-08-05T09:00:00.000Z",
    durationSec: 60,
    state: "completed" as CallState,
    outcome: "lead_created" as CallOutcome,
    intent: "запись",
    consentGiven: true,
    transcript: [],
    transitions: [],
    summary: "",
    leadId: null,
    bookingId: null,
    handoff: null,
    followUpIds: [],
    errors: [],
    unansweredQuestions: [],
    costTenge: 10,
    scenarioId: "s",
    ...overrides,
  }
}

function followUp(callId: string, status: FollowUp["status"]): FollowUp {
  return {
    id: `${callId}-fu`,
    companyId: "co",
    callId,
    channel: "whatsapp",
    recipient: "+7 700 000 00 00",
    text: "текст",
    status,
    reason: "—",
    errorReason: null,
    createdAt: "2026-08-05T09:00:00.000Z",
  }
}

describe("computeMetrics — пустой ввод", () => {
  it("не делит на ноль", () => {
    const m = computeMetrics("7d", [], [], NOW)
    expect(m.totalCalls).toBe(0)
    expect(m.conversionPct).toBe(0)
    expect(m.avgDurationSec).toBe(0)
    expect(m.outcomes).toEqual([])
  })
})

describe("computeMetrics — состояния звонка", () => {
  it("no_answer и provider_failed считаются пропущенными", () => {
    const m = computeMetrics(
      "7d",
      [
        call({ callId: "a", state: "completed" }),
        call({ callId: "b", state: "no_answer" }),
        call({ callId: "c", state: "provider_failed" }),
      ],
      [],
      NOW,
    )
    expect(m.totalCalls).toBe(3)
    expect(m.answered).toBe(1)
    expect(m.missed).toBe(2)
    expect(m.completed).toBe(1)
  })

  it("конверсия считается от отвеченных, а не от всех", () => {
    const m = computeMetrics(
      "7d",
      [
        call({ callId: "a", leadId: "l1" }),
        call({ callId: "b", state: "no_answer" }),
      ],
      [],
      NOW,
    )
    // 1 лид на 1 отвеченный = 100%, пропущенный не размывает результат.
    expect(m.conversionPct).toBe(100)
  })

  it("считает передачи оператору и записи", () => {
    const m = computeMetrics(
      "7d",
      [
        call({ callId: "a", handoff: { reason: "сложный вопрос", at: NOW.toISOString() } as never }),
        call({ callId: "b", bookingId: "bk1" }),
      ],
      [],
      NOW,
    )
    expect(m.handoffs).toBe(1)
    expect(m.bookings).toBe(1)
  })
})

describe("computeMetrics — follow-up", () => {
  it("учитывает только отправленные и только по звонкам периода", () => {
    const calls = [call({ callId: "in" })]
    const followUps = [
      followUp("in", "sent_mock"),
      followUp("in", "failed"),
      // Звонка "outside" нет в выборке — его follow-up учитываться не должен.
      followUp("outside", "sent_mock"),
    ]
    const m = computeMetrics("7d", calls, followUps, NOW)
    expect(m.followUpsSent).toBe(1)
  })

  it("без follow-up не падает", () => {
    expect(computeMetrics("7d", [call({ callId: "a" })], undefined, NOW).followUpsSent).toBe(0)
  })
})

describe("computeMetrics — период", () => {
  it("7d исключает звонок старше окна", () => {
    const m = computeMetrics(
      "7d",
      [
        call({ callId: "fresh", startedAt: "2026-08-04T09:00:00.000Z" }),
        call({ callId: "stale", startedAt: "2026-07-01T09:00:00.000Z" }),
      ],
      [],
      NOW,
    )
    expect(m.totalCalls).toBe(1)
  })

  it("30d включает то, что не попало в 7d", () => {
    const calls = [call({ callId: "mid", startedAt: "2026-07-20T09:00:00.000Z" })]
    expect(computeMetrics("7d", calls, [], NOW).totalCalls).toBe(0)
    expect(computeMetrics("30d", calls, [], NOW).totalCalls).toBe(1)
  })

  it("«сегодня» согласовано с последним столбцом графика", () => {
    const calls = [
      call({ callId: "today1", startedAt: "2026-08-05T01:00:00.000Z" }),
      call({ callId: "today2", startedAt: "2026-08-05T23:30:00.000Z" }),
      call({ callId: "yesterday", startedAt: "2026-08-04T23:30:00.000Z" }),
    ]
    const today = computeMetrics("today", calls, [], NOW).totalCalls
    const series = callsPerDay(2, calls, NOW)
    // Оба показателя выводятся на одном экране и обязаны совпадать.
    expect(today).toBe(2)
    expect(series[series.length - 1].calls).toBe(today)
  })

  it("будущий звонок не ломает окно", () => {
    // Отрицательная разница проходит проверку `<= days`, поэтому звонок
    // «из будущего» попадёт в период — фиксируем это поведение явно.
    const m = computeMetrics("7d", [call({ callId: "future", startedAt: "2026-09-01T09:00:00.000Z" })], [], NOW)
    expect(m.totalCalls).toBe(1)
  })
})

describe("computeMetrics — агрегаты", () => {
  it("суммирует стоимость и усредняет длительность", () => {
    const m = computeMetrics(
      "7d",
      [
        call({ callId: "a", durationSec: 30, costTenge: 5 }),
        call({ callId: "b", durationSec: 90, costTenge: 15 }),
      ],
      [],
      NOW,
    )
    expect(m.totalCostTenge).toBe(20)
    expect(m.avgDurationSec).toBe(60)
  })

  it("сортирует исходы и интенты по убыванию", () => {
    const m = computeMetrics(
      "7d",
      [
        call({ callId: "a", outcome: "booking_created", intent: "запись" }),
        call({ callId: "b", outcome: "booking_created", intent: "запись" }),
        call({ callId: "c", outcome: "info_only", intent: "вопрос" }),
      ],
      [],
      NOW,
    )
    expect(m.outcomes[0]).toEqual({ outcome: "booking_created", count: 2 })
    expect(m.topIntents[0]).toEqual({ intent: "запись", count: 2 })
  })

  it("ограничивает список интентов шестью", () => {
    const calls = Array.from({ length: 9 }, (_, i) =>
      call({ callId: `c${i}`, intent: `интент-${i}` }),
    )
    expect(computeMetrics("7d", calls, [], NOW).topIntents).toHaveLength(6)
  })

  it("пустой интент не попадает в список", () => {
    const m = computeMetrics("7d", [call({ callId: "a", intent: null })], [], NOW)
    expect(m.topIntents).toEqual([])
  })

  it("собирает неотвеченные вопросы всех звонков", () => {
    const m = computeMetrics(
      "7d",
      [
        call({ callId: "a", unansweredQuestions: ["Цена?"] }),
        call({ callId: "b", unansweredQuestions: ["Рассрочка?", "Скидка?"] }),
      ],
      [],
      NOW,
    )
    expect(m.unansweredQuestions).toEqual(["Цена?", "Рассрочка?", "Скидка?"])
  })
})

describe("callsPerDay", () => {
  it("возвращает ряд нужной длины, от старых к новым", () => {
    const series = callsPerDay(7, [], NOW)
    expect(series).toHaveLength(7)
    expect(series[0].date).toBe("2026-07-30")
    expect(series[6].date).toBe("2026-08-05")
  })

  it("раскладывает звонки и лиды по дням", () => {
    const series = callsPerDay(
      3,
      [
        call({ callId: "a", startedAt: "2026-08-05T09:00:00.000Z", leadId: "l1" }),
        call({ callId: "b", startedAt: "2026-08-05T11:00:00.000Z" }),
        call({ callId: "c", startedAt: "2026-08-04T10:00:00.000Z" }),
      ],
      NOW,
    )
    const last = series[series.length - 1]
    expect(last).toEqual({ date: "2026-08-05", calls: 2, leads: 1 })
    expect(series[series.length - 2]).toEqual({ date: "2026-08-04", calls: 1, leads: 0 })
  })

  it("дни без звонков остаются нулями, а не пропусками", () => {
    const series = callsPerDay(3, [], NOW)
    expect(series.every((d) => d.calls === 0 && d.leads === 0)).toBe(true)
  })
})

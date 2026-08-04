import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"

import { db, pool } from "@/lib/db"
import {
  voiceBookings,
  voiceCallTransitions,
  voiceCalls,
  voiceCompanies,
  voiceFollowUps,
  voiceLeads,
  voiceOutboxEvents,
  voiceTranscripts,
} from "@/lib/db/schema"
import type { ScenarioRunResult } from "@/lib/voice/engine"
import {
  callSummaries,
  followUpsForCalls,
  getCallDetail,
  listCallsByCompany,
  persistRun,
  storeCounters,
} from "@/lib/voice/persist"

const CO = "test_persist_co"
const OTHER_CO = "test_persist_other"

/**
 * Прогон собирается вручную, а не через runScenario: сценарии привязаны к
 * реальным companyId демо-арендаторов, и тест затирал бы засеянные данные.
 * Здесь нужен полный контроль над идентификаторами для точной очистки.
 */
function makeRun(overrides: {
  callId: string
  companyId?: string
  startedAt?: string
  withLead?: boolean
  withBooking?: boolean
  bookingDate?: string
  bookingTime?: string
  followUpCount?: number
  eventKeys?: string[]
}): ScenarioRunResult {
  const companyId = overrides.companyId ?? CO
  const callId = overrides.callId
  const startedAt = overrides.startedAt ?? "2026-08-05T09:00:00.000Z"
  const leadId = overrides.withLead === false ? null : `${callId}-lead`
  const bookingId = overrides.withBooking ? `${callId}-booking` : null

  return {
    call: {
      callId,
      companyId,
      providerCallId: `prov-${callId}`,
      clientName: "Айгуль",
      clientPhone: "+7 701 000 00 00",
      direction: "inbound",
      startedAt,
      durationSec: 96,
      state: "completed",
      outcome: overrides.withBooking ? "booking_created" : "lead_created",
      intent: "запись",
      consentGiven: true,
      transcript: [
        { role: "assistant", text: "Здравствуйте!", at: startedAt, state: "greeting" },
        { role: "client", text: "Хочу записаться", at: startedAt, state: "identifying_intent" },
      ],
      transitions: [
        { from: "greeting", to: "identifying_intent", at: startedAt },
        { from: "identifying_intent", to: "completed", at: startedAt, note: "готово" },
      ],
      summary: "Клиент записан",
      leadId,
      bookingId,
      handoff: null,
      followUpIds: [],
      errors: [],
      unansweredQuestions: ["Есть ли рассрочка?"],
      costTenge: 42,
      scenarioId: "test-scenario",
    },
    lead:
      leadId === null
        ? null
        : {
            id: leadId,
            companyId,
            callId,
            name: "Айгуль",
            phone: "+7 701 000 00 00",
            interest: "Запись",
            niche: "Тест",
            service: "Консультация",
            source: "voice_ai",
            intent: "запись",
            score: 71,
            temperature: "warm",
            comment: "—",
            managerSummary: "Тёплый лид",
            nextBestAction: "Позвонить",
            crmStatus: "synced_mock",
            crmExternalId: "crm-1",
            createdAt: startedAt,
          },
    booking: bookingId
      ? {
          id: bookingId,
          companyId,
          callId,
          leadId: leadId ?? "",
          service: "Консультация",
          date: overrides.bookingDate ?? "2026-08-07",
          time: overrides.bookingTime ?? "15:30",
          status: "confirmed",
          calendarStatus: "synced_mock",
          createdAt: startedAt,
        }
      : null,
    followUps: Array.from({ length: overrides.followUpCount ?? 1 }, (_, i) => ({
      id: `${callId}-fu-${i}`,
      companyId,
      callId,
      channel: "whatsapp" as const,
      recipient: "+7 701 000 00 00",
      text: "Ждём вас",
      status: "sent_mock" as const,
      reason: "подтверждение",
      errorReason: null,
      createdAt: startedAt,
    })),
    events: (overrides.eventKeys ?? [`${callId}:completed`]).map((key, i) => ({
      eventId: `${callId}-ev-${i}`,
      companyId,
      callId,
      type: "voice.call.completed" as const,
      timestamp: startedAt,
      idempotencyKey: key,
      payload: { callId },
    })),
  }
}

async function cleanup() {
  for (const company of [CO, OTHER_CO]) {
    await db.delete(voiceOutboxEvents).where(eq(voiceOutboxEvents.companyId, company))
    await db.delete(voiceTranscripts).where(eq(voiceTranscripts.companyId, company))
    await db.delete(voiceCallTransitions).where(eq(voiceCallTransitions.companyId, company))
    await db.delete(voiceFollowUps).where(eq(voiceFollowUps.companyId, company))
    await db.delete(voiceBookings).where(eq(voiceBookings.companyId, company))
    // Звонок ссылается на лид и запись, поэтому удаляется до них.
    await db.delete(voiceCalls).where(eq(voiceCalls.companyId, company))
    await db.delete(voiceLeads).where(eq(voiceLeads.companyId, company))
  }
}

beforeEach(async () => {
  await cleanup()
  await db
    .insert(voiceCompanies)
    .values([
      { companyId: CO, name: "Persist Test", mode: "demo" as const },
      { companyId: OTHER_CO, name: "Persist Other", mode: "demo" as const },
    ])
    .onConflictDoNothing({ target: voiceCompanies.companyId })
})

afterAll(async () => {
  await cleanup()
  await db.delete(voiceCompanies).where(eq(voiceCompanies.companyId, CO))
  await db.delete(voiceCompanies).where(eq(voiceCompanies.companyId, OTHER_CO))
  await pool.end()
})

describe("persistRun — запись артефактов", () => {
  it("пишет звонок со всеми связанными сущностями", async () => {
    await persistRun(makeRun({ callId: "c1", withBooking: true, followUpCount: 2 }))

    const detail = await getCallDetail("c1", CO)
    expect(detail).not.toBeNull()
    expect(detail!.call.callId).toBe("c1")
    expect(detail!.call.summary).toBe("Клиент записан")
    expect(detail!.call.transcript).toHaveLength(2)
    expect(detail!.call.transitions).toHaveLength(2)
    expect(detail!.lead?.score).toBe(71)
    expect(detail!.booking?.status).toBe("confirmed")
    expect(detail!.followUps).toHaveLength(2)
  })

  it("сохраняет звонок без лида и записи", async () => {
    await persistRun(
      makeRun({ callId: "c_bare", withLead: false, followUpCount: 0, eventKeys: [] }),
    )

    const detail = await getCallDetail("c_bare", CO)
    expect(detail!.lead).toBeNull()
    expect(detail!.booking).toBeNull()
    expect(detail!.followUps).toEqual([])
  })

  it("переносит массивы и необязательные поля без потерь", async () => {
    await persistRun(makeRun({ callId: "c_arrays" }))

    const detail = await getCallDetail("c_arrays", CO)
    expect(detail!.call.unansweredQuestions).toEqual(["Есть ли рассрочка?"])
    expect(detail!.call.errors).toEqual([])
    expect(detail!.call.handoff).toBeNull()
    expect(detail!.call.transitions[1]?.note).toBe("готово")
  })

  it("публикует события прогона в outbox", async () => {
    await persistRun(makeRun({ callId: "c_ev", eventKeys: ["k1", "k2"] }))

    const rows = await db.select().from(voiceOutboxEvents).where(eq(voiceOutboxEvents.companyId, CO))
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.status === "pending")).toBe(true)
  })
})

describe("persistRun — идемпотентность", () => {
  it("повторный прогон того же звонка не плодит дубли", async () => {
    const run = makeRun({ callId: "c_dup", withBooking: true, followUpCount: 2 })
    await persistRun(run)
    await persistRun(run)

    const detail = await getCallDetail("c_dup", CO)
    // Главное: дочерние строки не удвоились.
    expect(detail!.call.transcript).toHaveLength(2)
    expect(detail!.call.transitions).toHaveLength(2)
    expect(detail!.followUps).toHaveLength(2)

    const calls = await db.select().from(voiceCalls).where(eq(voiceCalls.callId, "c_dup"))
    expect(calls).toHaveLength(1)
  })

  it("повтор не создаёт второе событие с тем же ключом", async () => {
    const run = makeRun({ callId: "c_dup_ev", eventKeys: ["stable-key"] })
    await persistRun(run)
    await persistRun(run)

    const rows = await db.select().from(voiceOutboxEvents).where(eq(voiceOutboxEvents.companyId, CO))
    expect(rows).toHaveLength(1)
  })
})

describe("Бронирование — round-trip даты и времени", () => {
  it("время записи читается ровно таким, каким записано", async () => {
    await persistRun(
      makeRun({
        callId: "c_tz",
        withBooking: true,
        bookingDate: "2026-12-31",
        bookingTime: "23:45",
      }),
    )

    const detail = await getCallDetail("c_tz", CO)
    // Схема хранит момент времени, домен — строки. Границы суток и года —
    // самый вероятный случай сползания даты на единицу.
    expect(detail!.booking?.date).toBe("2026-12-31")
    expect(detail!.booking?.time).toBe("23:45")
  })

  it("полночь не уезжает на предыдущий день", async () => {
    await persistRun(
      makeRun({ callId: "c_mid", withBooking: true, bookingDate: "2026-03-01", bookingTime: "00:00" }),
    )

    const detail = await getCallDetail("c_mid", CO)
    expect(detail!.booking?.date).toBe("2026-03-01")
    expect(detail!.booking?.time).toBe("00:00")
  })
})

describe("Изоляция арендаторов", () => {
  it("listCallsByCompany не отдаёт звонки другой компании", async () => {
    await persistRun(makeRun({ callId: "c_mine", companyId: CO }))
    await persistRun(makeRun({ callId: "c_theirs", companyId: OTHER_CO }))

    const mine = await listCallsByCompany(CO)
    expect(mine.map((c) => c.callId)).toEqual(["c_mine"])

    const theirs = await listCallsByCompany(OTHER_CO)
    expect(theirs.map((c) => c.callId)).toEqual(["c_theirs"])
  })
})

describe("Чтение и сортировка", () => {
  it("звонки возвращаются от новых к старым", async () => {
    await persistRun(makeRun({ callId: "c_old", startedAt: "2026-08-01T09:00:00.000Z" }))
    await persistRun(makeRun({ callId: "c_new", startedAt: "2026-08-04T09:00:00.000Z" }))

    const calls = await listCallsByCompany(CO)
    expect(calls.map((c) => c.callId)).toEqual(["c_new", "c_old"])
  })

  it("getCallDetail возвращает null для неизвестного звонка", async () => {
    expect(await getCallDetail("нет-такого", CO)).toBeNull()
  })

  it("звонок чужой компании недоступен даже по точному callId", async () => {
    await persistRun(makeRun({ callId: "c_secret" }))

    // Идентификатор верный, компания — чужая. Данные не должны отдаваться:
    // иначе ссылки на звонки утекали бы между клиентами сервиса.
    expect(await getCallDetail("c_secret", OTHER_CO)).toBeNull()
    expect(await getCallDetail("c_secret", CO)).not.toBeNull()
  })

  it("пакетные выборки не отдают данные чужой компании", async () => {
    await persistRun(makeRun({ callId: "c_batch", followUpCount: 2 }))

    expect((await callSummaries(["c_batch"], OTHER_CO)).size).toBe(0)
    expect(await followUpsForCalls(["c_batch"], OTHER_CO)).toEqual([])
  })
})

describe("Пакетные выборки", () => {
  it("callSummaries отдаёт клиентов одним запросом", async () => {
    await persistRun(makeRun({ callId: "c_a" }))
    await persistRun(makeRun({ callId: "c_b" }))

    const map = await callSummaries(["c_a", "c_b", "нет-такого"], CO)
    expect(map.size).toBe(2)
    expect(map.get("c_a")?.clientName).toBe("Айгуль")
  })

  it("пустой список не идёт в базу", async () => {
    expect((await callSummaries([], CO)).size).toBe(0)
    expect(await followUpsForCalls([], CO)).toEqual([])
  })

  it("followUpsForCalls собирает follow-up нескольких звонков", async () => {
    await persistRun(makeRun({ callId: "c_f1", followUpCount: 2 }))
    await persistRun(makeRun({ callId: "c_f2", followUpCount: 1 }))

    const followUps = await followUpsForCalls(["c_f1", "c_f2"], CO)
    expect(followUps).toHaveLength(3)
  })
})

describe("Счётчики", () => {
  it("storeCounters считает записанное", async () => {
    const before = await storeCounters()
    await persistRun(makeRun({ callId: "c_count", withBooking: true, followUpCount: 1 }))
    const after = await storeCounters()

    expect(after.calls).toBe(before.calls + 1)
    expect(after.leads).toBe(before.leads + 1)
    expect(after.bookings).toBe(before.bookings + 1)
    expect(after.followUps).toBe(before.followUps + 1)
  })
})

// Интеграционные тесты booking-провайдера против реальной Neon.
// Проверяют то, что нельзя проверить моками: гонки на слоте и идемпотентность на уровне БД.

import { and, eq, like } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "@/lib/db"
import { voiceBookings, voiceSlotHolds } from "@/lib/db/schema"
import { BookingError } from "@/lib/voice/providers/booking"
import { DEFAULT_CATALOG, DatabaseBookingProvider } from "@/lib/voice/providers/booking-db"

const hasDb = Boolean(process.env.DATABASE_URL)
const describeDb = hasDb ? describe : describe.skip

const COMPANY = "test_co_booking"
const OTHER_COMPANY = "test_co_other"
const SERVICE = "svc_consult"

/** Слот в будущем, внутри рабочих часов каталога (9:00–19:00 UTC). */
function futureSlot(dayOffset = 2, hour = 11) {
  const start = new Date()
  start.setUTCDate(start.getUTCDate() + dayOffset)
  start.setUTCHours(hour, 0, 0, 0)
  const end = new Date(start.getTime() + 30 * 60_000)
  return { startsAt: start.toISOString(), endsAt: end.toISOString() }
}

async function cleanup() {
  for (const company of [COMPANY, OTHER_COMPANY]) {
    await db.delete(voiceSlotHolds).where(eq(voiceSlotHolds.companyId, company))
    await db.delete(voiceBookings).where(eq(voiceBookings.companyId, company))
  }
}

describeDb("DatabaseBookingProvider", () => {
  const provider = new DatabaseBookingProvider()

  beforeAll(cleanup)
  afterAll(cleanup)

  it("сообщает, что настроен при наличии DATABASE_URL", () => {
    expect(provider.isConfigured()).toBe(true)
  })

  it("отдаёт каталог услуг", async () => {
    const services = await provider.listServices(COMPANY)
    expect(services.length).toBeGreaterThan(0)
    expect(services.every((s) => s.active)).toBe(true)
  })

  it("отклоняет неизвестную услугу", async () => {
    const slot = futureSlot()
    await expect(
      provider.holdSlot({ companyId: COMPANY, callId: "c1", serviceId: "нет_такой", ...slot, ttlSec: 60 }),
    ).rejects.toThrow(BookingError)
  })

  it("удерживает слот и возвращает срок истечения", async () => {
    const slot = futureSlot(2, 10)
    const hold = await provider.holdSlot({
      companyId: COMPANY,
      callId: "c_hold",
      serviceId: SERVICE,
      ...slot,
      ttlSec: 120,
    })
    expect(hold.status).toBe("held")
    expect(new Date(hold.expiresAt).getTime()).toBeGreaterThan(Date.now())
    await provider.releaseHold(COMPANY, hold.holdId)
  })

  it("не позволяет удержать слот в прошлом", async () => {
    const past = new Date(Date.now() - 3600_000)
    await expect(
      provider.holdSlot({
        companyId: COMPANY,
        callId: "c_past",
        serviceId: SERVICE,
        startsAt: past.toISOString(),
        endsAt: new Date(past.getTime() + 30 * 60_000).toISOString(),
        ttlSec: 60,
      }),
    ).rejects.toMatchObject({ code: "slot_expired" })
  })

  it("КРИТИЧНО: два параллельных звонка не могут удержать один слот", async () => {
    const slot = futureSlot(3, 12)
    const attempt = (callId: string) =>
      provider.holdSlot({ companyId: COMPANY, callId, serviceId: SERVICE, ...slot, ttlSec: 120 })

    const results = await Promise.allSettled([attempt("call_A"), attempt("call_B")])
    const fulfilled = results.filter((r) => r.status === "fulfilled")
    const rejected = results.filter((r) => r.status === "rejected")

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "slot_taken" })
  })

  it("освобождённый слот можно удержать заново", async () => {
    const slot = futureSlot(4, 13)
    const first = await provider.holdSlot({
      companyId: COMPANY,
      callId: "c_rel_1",
      serviceId: SERVICE,
      ...slot,
      ttlSec: 120,
    })
    await provider.releaseHold(COMPANY, first.holdId)
    const second = await provider.holdSlot({
      companyId: COMPANY,
      callId: "c_rel_2",
      serviceId: SERVICE,
      ...slot,
      ttlSec: 120,
    })
    expect(second.holdId).not.toBe(first.holdId)
    await provider.releaseHold(COMPANY, second.holdId)
  })

  it("подтверждает запись по действующему удержанию", async () => {
    const slot = futureSlot(5, 14)
    const hold = await provider.holdSlot({
      companyId: COMPANY,
      callId: "c_conf",
      serviceId: SERVICE,
      ...slot,
      ttlSec: 300,
    })
    const booking = await provider.confirmBooking({
      companyId: COMPANY,
      callId: "c_conf",
      holdId: hold.holdId,
      clientName: "Тестовый Клиент",
      clientPhone: "+77770000001",
      idempotencyKey: "idem_confirm_1",
    })
    expect(booking.status).toBe("confirmed")
    expect(booking.deduplicated).toBe(false)
  })

  it("КРИТИЧНО: повторный вызов с тем же ключом не создаёт дубль", async () => {
    const slot = futureSlot(6, 15)
    const hold = await provider.holdSlot({
      companyId: COMPANY,
      callId: "c_idem",
      serviceId: SERVICE,
      ...slot,
      ttlSec: 300,
    })
    const request = {
      companyId: COMPANY,
      callId: "c_idem",
      holdId: hold.holdId,
      clientName: "Клиент",
      clientPhone: "+77770000002",
      idempotencyKey: "idem_same_key",
    }
    const first = await provider.confirmBooking(request)
    const second = await provider.confirmBooking(request)

    expect(second.bookingId).toBe(first.bookingId)
    expect(second.deduplicated).toBe(true)

    const rows = await db
      .select()
      .from(voiceBookings)
      .where(and(eq(voiceBookings.companyId, COMPANY), eq(voiceBookings.idempotencyKey, "idem_same_key")))
    expect(rows).toHaveLength(1)
  })

  it("отклоняет подтверждение по истёкшему удержанию", async () => {
    const slot = futureSlot(7, 16)
    const hold = await provider.holdSlot({
      companyId: COMPANY,
      callId: "c_exp",
      serviceId: SERVICE,
      ...slot,
      ttlSec: 1,
    })
    // Принудительно помечаем истёкшим, не дожидаясь реального времени.
    await db
      .update(voiceSlotHolds)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(voiceSlotHolds.holdId, hold.holdId))

    await expect(
      provider.confirmBooking({
        companyId: COMPANY,
        callId: "c_exp",
        holdId: hold.holdId,
        clientName: "Клиент",
        clientPhone: "+77770000003",
        idempotencyKey: "idem_expired",
      }),
    ).rejects.toMatchObject({ code: "hold_expired" })
  })

  it("отклоняет подтверждение по несуществующему удержанию", async () => {
    await expect(
      provider.confirmBooking({
        companyId: COMPANY,
        callId: "c_none",
        holdId: "hold_не_существует",
        clientName: "Клиент",
        clientPhone: "+77770000004",
        idempotencyKey: "idem_missing_hold",
      }),
    ).rejects.toMatchObject({ code: "hold_not_found" })
  })

  it("КРИТИЧНО: чужая компания не может подтвердить удержание", async () => {
    const slot = futureSlot(8, 17)
    const hold = await provider.holdSlot({
      companyId: COMPANY,
      callId: "c_tenant",
      serviceId: SERVICE,
      ...slot,
      ttlSec: 300,
    })
    await expect(
      provider.confirmBooking({
        companyId: OTHER_COMPANY,
        callId: "c_attack",
        holdId: hold.holdId,
        clientName: "Атакующий",
        clientPhone: "+77770000005",
        idempotencyKey: "idem_cross_tenant",
      }),
    ).rejects.toMatchObject({ code: "hold_not_found" })
  })

  it("КРИТИЧНО: чужая компания не может отменить запись", async () => {
    const slot = futureSlot(9, 11)
    const hold = await provider.holdSlot({
      companyId: COMPANY,
      callId: "c_cancel",
      serviceId: SERVICE,
      ...slot,
      ttlSec: 300,
    })
    const booking = await provider.confirmBooking({
      companyId: COMPANY,
      callId: "c_cancel",
      holdId: hold.holdId,
      clientName: "Клиент",
      clientPhone: "+77770000006",
      idempotencyKey: "idem_cancel_scope",
    })

    await expect(
      provider.cancelBooking({
        companyId: OTHER_COMPANY,
        bookingId: booking.bookingId,
        reason: "попытка из чужой компании",
        idempotencyKey: "idem_cancel_attack",
      }),
    ).rejects.toMatchObject({ code: "booking_not_found" })

    // Запись должна остаться нетронутой.
    const rows = await db.select().from(voiceBookings).where(eq(voiceBookings.id, booking.bookingId))
    expect(rows[0].status).toBe("confirmed")
  })

  it("доступность не содержит уже подтверждённых слотов", async () => {
    const slot = futureSlot(10, 12)
    const hold = await provider.holdSlot({
      companyId: COMPANY,
      callId: "c_avail",
      serviceId: SERVICE,
      ...slot,
      ttlSec: 300,
    })
    await provider.confirmBooking({
      companyId: COMPANY,
      callId: "c_avail",
      holdId: hold.holdId,
      clientName: "Клиент",
      clientPhone: "+77770000007",
      idempotencyKey: "idem_avail",
    })

    const dayStart = new Date(slot.startsAt)
    dayStart.setUTCHours(9, 0, 0, 0)
    const dayEnd = new Date(slot.startsAt)
    dayEnd.setUTCHours(19, 0, 0, 0)

    const slots = await provider.getAvailability({
      companyId: COMPANY,
      serviceId: SERVICE,
      fromIso: dayStart.toISOString(),
      toIso: dayEnd.toISOString(),
    })
    expect(slots.some((s) => s.startsAt === slot.startsAt)).toBe(false)
  })

  it("доступность изолирована между компаниями", async () => {
    const slot = futureSlot(11, 13)
    const hold = await provider.holdSlot({
      companyId: COMPANY,
      callId: "c_iso",
      serviceId: SERVICE,
      ...slot,
      ttlSec: 300,
    })

    const dayStart = new Date(slot.startsAt)
    dayStart.setUTCHours(9, 0, 0, 0)
    const dayEnd = new Date(slot.startsAt)
    dayEnd.setUTCHours(19, 0, 0, 0)

    // Для другой компании этот слот занят не должен быть.
    const otherSlots = await provider.getAvailability({
      companyId: OTHER_COMPANY,
      serviceId: SERVICE,
      fromIso: dayStart.toISOString(),
      toIso: dayEnd.toISOString(),
    })
    expect(otherSlots.some((s) => s.startsAt === slot.startsAt)).toBe(true)
    await provider.releaseHold(COMPANY, hold.holdId)
  })

  it("перенос записи на занятый слот отклоняется", async () => {
    const slotA = futureSlot(12, 10)
    const slotB = futureSlot(12, 11)

    const holdA = await provider.holdSlot({
      companyId: COMPANY,
      callId: "c_r1",
      serviceId: SERVICE,
      ...slotA,
      ttlSec: 300,
    })
    const bookingA = await provider.confirmBooking({
      companyId: COMPANY,
      callId: "c_r1",
      holdId: holdA.holdId,
      clientName: "Клиент А",
      clientPhone: "+77770000008",
      idempotencyKey: "idem_r1",
    })

    const holdB = await provider.holdSlot({
      companyId: COMPANY,
      callId: "c_r2",
      serviceId: SERVICE,
      ...slotB,
      ttlSec: 300,
    })
    await provider.confirmBooking({
      companyId: COMPANY,
      callId: "c_r2",
      holdId: holdB.holdId,
      clientName: "Клиент Б",
      clientPhone: "+77770000009",
      idempotencyKey: "idem_r2",
    })

    await expect(
      provider.rescheduleBooking({
        companyId: COMPANY,
        bookingId: bookingA.bookingId,
        startsAt: slotB.startsAt,
        endsAt: slotB.endsAt,
        idempotencyKey: "idem_reschedule_conflict",
      }),
    ).rejects.toMatchObject({ code: "slot_taken" })
  })

  it("истёкшие удержания освобождают слот", async () => {
    const slot = futureSlot(13, 14)
    const hold = await provider.holdSlot({
      companyId: COMPANY,
      callId: "c_stale",
      serviceId: SERVICE,
      ...slot,
      ttlSec: 300,
    })
    await db
      .update(voiceSlotHolds)
      .set({ expiresAt: new Date(Date.now() - 5000) })
      .where(eq(voiceSlotHolds.holdId, hold.holdId))

    const freed = await provider.expireStaleHolds(COMPANY)
    expect(freed).toBeGreaterThanOrEqual(1)

    const reHold = await provider.holdSlot({
      companyId: COMPANY,
      callId: "c_stale_2",
      serviceId: SERVICE,
      ...slot,
      ttlSec: 120,
    })
    expect(reHold.status).toBe("held")
    await provider.releaseHold(COMPANY, reHold.holdId)
  })
})

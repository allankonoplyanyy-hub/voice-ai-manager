// Booking-провайдер поверх Neon.
// Это не «мок»: удержание слота опирается на уникальный частичный индекс
// voice_slot_holds_slot_idx, поэтому два параллельных звонка физически не могут
// удержать один и тот же слот — второй получит ошибку уникальности от Postgres.

import { and, eq, gte, lt, ne } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { db } from "@/lib/db"
import { voiceBookings, voiceSlotHolds } from "@/lib/db/schema"
import {
  type AvailabilityQuery,
  BookingError,
  type BookingProvider,
  type BookingRecord,
  type CancelRequest,
  type ConfirmRequest,
  type Hold,
  type HoldRequest,
  type Location,
  type RescheduleRequest,
  type Service,
  type Slot,
  type Staff,
} from "./booking"

/** Код нарушения уникальности в Postgres. */
const UNIQUE_VIOLATION = "23505"

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === UNIQUE_VIOLATION
}

/**
 * Каталог услуг. Пока задаётся конфигурацией компании, а не внешним API —
 * это осознанная граница: каталог статичен, а доступность и holds уже реальные.
 */
export interface CatalogSource {
  services: Service[]
  staff: Staff[]
  locations: Location[]
  workingHours: { startHour: number; endHour: number }
  slotStepMin: number
}

export const DEFAULT_CATALOG: CatalogSource = {
  services: [
    {
      serviceId: "svc_consult",
      name: "Консультация",
      durationMin: 30,
      priceTenge: 10000,
      locationIds: ["loc_main"],
      staffIds: ["staff_1"],
      active: true,
    },
    {
      serviceId: "svc_full",
      name: "Полный приём",
      durationMin: 60,
      priceTenge: 20000,
      locationIds: ["loc_main"],
      staffIds: ["staff_1", "staff_2"],
      active: true,
    },
  ],
  staff: [
    { staffId: "staff_1", name: "Специалист 1", serviceIds: ["svc_consult", "svc_full"], locationId: "loc_main" },
    { staffId: "staff_2", name: "Специалист 2", serviceIds: ["svc_full"], locationId: "loc_main" },
  ],
  locations: [{ locationId: "loc_main", name: "Основной офис", address: "г. Алматы", timezone: "Asia/Almaty" }],
  workingHours: { startHour: 9, endHour: 19 },
  slotStepMin: 30,
}

export class DatabaseBookingProvider implements BookingProvider {
  readonly name = "neon"
  private readonly catalog: CatalogSource

  constructor(catalog: CatalogSource = DEFAULT_CATALOG) {
    this.catalog = catalog
  }

  isConfigured(): boolean {
    return Boolean(process.env.DATABASE_URL)
  }

  async listServices(): Promise<Service[]> {
    return this.catalog.services.filter((s) => s.active)
  }

  async listStaff(): Promise<Staff[]> {
    return this.catalog.staff
  }

  async listLocations(): Promise<Location[]> {
    return this.catalog.locations
  }

  private service(serviceId: string): Service {
    const found = this.catalog.services.find((s) => s.serviceId === serviceId && s.active)
    if (!found) throw new BookingError("service_not_found", `Услуга ${serviceId} не найдена`, false)
    return found
  }

  /**
   * Доступность = сетка слотов рабочего дня минус активные holds минус подтверждённые записи.
   * Оба вычитания делаются одним запросом к БД, чтобы не отдать слот, который уже занят.
   */
  async getAvailability(query: AvailabilityQuery): Promise<Slot[]> {
    const service = this.service(query.serviceId)
    const from = new Date(query.fromIso)
    const to = new Date(query.toIso)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return []

    const now = new Date()

    const [holds, bookings] = await Promise.all([
      db
        .select({ startsAt: voiceSlotHolds.startsAt, endsAt: voiceSlotHolds.endsAt })
        .from(voiceSlotHolds)
        .where(
          and(
            eq(voiceSlotHolds.companyId, query.companyId),
            eq(voiceSlotHolds.serviceId, query.serviceId),
            eq(voiceSlotHolds.status, "held"),
            gte(voiceSlotHolds.expiresAt, now),
            lt(voiceSlotHolds.startsAt, to),
            gte(voiceSlotHolds.endsAt, from),
          ),
        ),
      db
        .select({ startsAt: voiceBookings.startsAt, endsAt: voiceBookings.endsAt })
        .from(voiceBookings)
        .where(
          and(
            eq(voiceBookings.companyId, query.companyId),
            eq(voiceBookings.serviceId, query.serviceId),
            ne(voiceBookings.status, "cancelled"),
            lt(voiceBookings.startsAt, to),
            gte(voiceBookings.endsAt, from),
          ),
        ),
    ])

    const busy = [...holds, ...bookings].map((b) => ({
      start: new Date(b.startsAt).getTime(),
      end: new Date(b.endsAt).getTime(),
    }))

    const slots: Slot[] = []
    const stepMs = this.catalog.slotStepMin * 60_000
    const durationMs = service.durationMin * 60_000

    for (let t = this.alignToStep(from, stepMs); t + durationMs <= to.getTime(); t += stepMs) {
      const start = new Date(t)
      const end = new Date(t + durationMs)
      if (start.getTime() < now.getTime()) continue
      if (!this.withinWorkingHours(start, end)) continue
      const overlaps = busy.some((b) => t < b.end && t + durationMs > b.start)
      if (overlaps) continue
      slots.push({
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        staffId: query.staffId ?? service.staffIds[0] ?? null,
        locationId: query.locationId ?? service.locationIds[0] ?? null,
      })
    }
    return slots
  }

  private alignToStep(date: Date, stepMs: number): number {
    return Math.ceil(date.getTime() / stepMs) * stepMs
  }

  private withinWorkingHours(start: Date, end: Date): boolean {
    const { startHour, endHour } = this.catalog.workingHours
    const startH = start.getUTCHours()
    const endH = end.getUTCHours() + (end.getUTCMinutes() > 0 ? 1 : 0)
    return startH >= startHour && endH <= endHour
  }

  /**
   * Удержание слота. Полагается на уникальный частичный индекс:
   * при гонке второй вызов получит 23505 и корректный slot_taken вместо двойной записи.
   */
  async holdSlot(request: HoldRequest): Promise<Hold> {
    this.service(request.serviceId)
    const startsAt = new Date(request.startsAt)
    const endsAt = new Date(request.endsAt)
    if (Number.isNaN(startsAt.getTime()) || endsAt <= startsAt) {
      throw new BookingError("slot_expired", "Некорректный интервал слота", false)
    }
    if (startsAt.getTime() < Date.now()) {
      throw new BookingError("slot_expired", "Слот уже в прошлом", false)
    }

    // Сначала снимаем истёкшие holds, иначе уникальный индекс держит освободившийся слот.
    await this.expireStaleHolds(request.companyId)

    const conflict = await db
      .select({ id: voiceBookings.id })
      .from(voiceBookings)
      .where(
        and(
          eq(voiceBookings.companyId, request.companyId),
          eq(voiceBookings.serviceId, request.serviceId),
          ne(voiceBookings.status, "cancelled"),
          lt(voiceBookings.startsAt, endsAt),
          gte(voiceBookings.endsAt, startsAt),
        ),
      )
      .limit(1)
    if (conflict.length > 0) throw new BookingError("slot_taken", "Слот уже занят", false)

    const holdId = `hold_${randomUUID()}`
    const expiresAt = new Date(Date.now() + request.ttlSec * 1000)

    try {
      await db.insert(voiceSlotHolds).values({
        holdId,
        companyId: request.companyId,
        callId: request.callId,
        serviceId: request.serviceId,
        locationId: request.locationId ?? null,
        staffId: request.staffId ?? null,
        startsAt,
        endsAt,
        status: "held",
        expiresAt,
      })
    } catch (error) {
      if (isUniqueViolation(error)) throw new BookingError("slot_taken", "Слот удерживается другим звонком", false)
      throw new BookingError("provider_unavailable", "Не удалось удержать слот", true)
    }

    return {
      holdId,
      companyId: request.companyId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: "held",
    }
  }

  /** Переводит просроченные holds в expired, освобождая уникальный индекс. */
  async expireStaleHolds(companyId: string): Promise<number> {
    const result = await db
      .update(voiceSlotHolds)
      .set({ status: "expired" })
      .where(
        and(
          eq(voiceSlotHolds.companyId, companyId),
          eq(voiceSlotHolds.status, "held"),
          lt(voiceSlotHolds.expiresAt, new Date()),
        ),
      )
      .returning({ holdId: voiceSlotHolds.holdId })
    return result.length
  }

  async releaseHold(companyId: string, holdId: string): Promise<void> {
    await db
      .update(voiceSlotHolds)
      .set({ status: "released" })
      .where(
        and(
          eq(voiceSlotHolds.companyId, companyId),
          eq(voiceSlotHolds.holdId, holdId),
          eq(voiceSlotHolds.status, "held"),
        ),
      )
  }

  /**
   * Подтверждение записи. Идемпотентно по (companyId, idempotencyKey):
   * повторный вызов возвращает существующую запись с deduplicated=true,
   * а не создаёт дубль — это защищает от retry телефонного провайдера.
   */
  async confirmBooking(request: ConfirmRequest): Promise<BookingRecord> {
    const existing = await db
      .select()
      .from(voiceBookings)
      .where(
        and(eq(voiceBookings.companyId, request.companyId), eq(voiceBookings.idempotencyKey, request.idempotencyKey)),
      )
      .limit(1)

    if (existing.length > 0) {
      const row = existing[0]
      return {
        bookingId: row.id,
        providerBookingId: row.providerBookingId,
        companyId: row.companyId,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        status: row.status as BookingRecord["status"],
        deduplicated: true,
      }
    }

    const holds = await db
      .select()
      .from(voiceSlotHolds)
      .where(and(eq(voiceSlotHolds.companyId, request.companyId), eq(voiceSlotHolds.holdId, request.holdId)))
      .limit(1)

    if (holds.length === 0) throw new BookingError("hold_not_found", "Удержание слота не найдено", false)
    const hold = holds[0]
    if (hold.status !== "held") throw new BookingError("hold_expired", `Удержание в статусе ${hold.status}`, false)
    if (hold.expiresAt.getTime() < Date.now()) {
      await db.update(voiceSlotHolds).set({ status: "expired" }).where(eq(voiceSlotHolds.holdId, request.holdId))
      throw new BookingError("hold_expired", "Удержание слота истекло", false)
    }

    const bookingId = `bk_${randomUUID()}`
    const service = this.catalog.services.find((s) => s.serviceId === hold.serviceId)

    try {
      await db.insert(voiceBookings).values({
        id: bookingId,
        companyId: request.companyId,
        callId: request.callId,
        serviceId: hold.serviceId,
        service: service?.name ?? hold.serviceId,
        locationId: hold.locationId,
        staffId: hold.staffId,
        startsAt: hold.startsAt,
        endsAt: hold.endsAt,
        status: "confirmed",
        provider: this.name,
        providerBookingId: bookingId,
        calendarStatus: "pending_retry",
        idempotencyKey: request.idempotencyKey,
        holdId: request.holdId,
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Гонка на том же ключе идемпотентности: перечитываем победителя.
        return this.confirmBooking(request)
      }
      throw new BookingError("provider_unavailable", "Не удалось создать запись", true)
    }

    await db.update(voiceSlotHolds).set({ status: "confirmed" }).where(eq(voiceSlotHolds.holdId, request.holdId))

    return {
      bookingId,
      providerBookingId: bookingId,
      companyId: request.companyId,
      startsAt: hold.startsAt.toISOString(),
      endsAt: hold.endsAt.toISOString(),
      status: "confirmed",
      deduplicated: false,
    }
  }

  async rescheduleBooking(request: RescheduleRequest): Promise<BookingRecord> {
    const rows = await db
      .select()
      .from(voiceBookings)
      .where(and(eq(voiceBookings.companyId, request.companyId), eq(voiceBookings.id, request.bookingId)))
      .limit(1)
    if (rows.length === 0) throw new BookingError("booking_not_found", "Запись не найдена", false)

    const startsAt = new Date(request.startsAt)
    const endsAt = new Date(request.endsAt)
    if (Number.isNaN(startsAt.getTime()) || endsAt <= startsAt) {
      throw new BookingError("slot_expired", "Некорректный новый интервал", false)
    }

    const conflict = await db
      .select({ id: voiceBookings.id })
      .from(voiceBookings)
      .where(
        and(
          eq(voiceBookings.companyId, request.companyId),
          eq(voiceBookings.serviceId, rows[0].serviceId),
          ne(voiceBookings.status, "cancelled"),
          ne(voiceBookings.id, request.bookingId),
          lt(voiceBookings.startsAt, endsAt),
          gte(voiceBookings.endsAt, startsAt),
        ),
      )
      .limit(1)
    if (conflict.length > 0) throw new BookingError("slot_taken", "Новый слот занят", false)

    await db
      .update(voiceBookings)
      .set({ startsAt, endsAt, updatedAt: new Date(), calendarStatus: "pending_retry" })
      .where(and(eq(voiceBookings.companyId, request.companyId), eq(voiceBookings.id, request.bookingId)))

    return {
      bookingId: request.bookingId,
      providerBookingId: rows[0].providerBookingId,
      companyId: request.companyId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      status: rows[0].status as BookingRecord["status"],
      deduplicated: false,
    }
  }

  async cancelBooking(request: CancelRequest): Promise<void> {
    const updated = await db
      .update(voiceBookings)
      .set({ status: "cancelled", cancelledReason: request.reason, updatedAt: new Date() })
      .where(and(eq(voiceBookings.companyId, request.companyId), eq(voiceBookings.id, request.bookingId)))
      .returning({ id: voiceBookings.id, holdId: voiceBookings.holdId })

    if (updated.length === 0) throw new BookingError("booking_not_found", "Запись не найдена", false)
    const holdId = updated[0].holdId
    if (holdId) {
      await db.update(voiceSlotHolds).set({ status: "released" }).where(eq(voiceSlotHolds.holdId, holdId))
    }
  }
}

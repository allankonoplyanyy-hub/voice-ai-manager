// Контракт booking-провайдера.
// Полный набор операций, без которых запись реально не работает: каталог услуг,
// доступность, удержание слота (hold), подтверждение, перенос, отмена.
// Hold обязателен — без него два параллельных звонка займут один слот.

export interface Service {
  serviceId: string
  name: string
  durationMin: number
  priceTenge: number
  locationIds: string[]
  staffIds: string[]
  active: boolean
}

export interface Staff {
  staffId: string
  name: string
  serviceIds: string[]
  locationId: string | null
}

export interface Location {
  locationId: string
  name: string
  address: string
  timezone: string
}

export interface Slot {
  startsAt: string
  endsAt: string
  staffId: string | null
  locationId: string | null
}

export interface AvailabilityQuery {
  companyId: string
  serviceId: string
  fromIso: string
  toIso: string
  staffId?: string | null
  locationId?: string | null
}

export interface HoldRequest {
  companyId: string
  callId: string
  serviceId: string
  startsAt: string
  endsAt: string
  staffId?: string | null
  locationId?: string | null
  ttlSec: number
}

export interface Hold {
  holdId: string
  companyId: string
  startsAt: string
  endsAt: string
  expiresAt: string
  status: "held" | "released" | "confirmed" | "expired"
}

export interface ConfirmRequest {
  companyId: string
  callId: string
  holdId: string
  clientName: string
  clientPhone: string
  /** Ключ идемпотентности: повторный вызов с тем же ключом не создаёт вторую запись. */
  idempotencyKey: string
  note?: string
}

export interface BookingRecord {
  bookingId: string
  providerBookingId: string | null
  companyId: string
  startsAt: string
  endsAt: string
  status: "confirmed" | "pending_manager" | "cancelled"
  /** true, если запись уже существовала и была возвращена по ключу идемпотентности. */
  deduplicated: boolean
}

export interface RescheduleRequest {
  companyId: string
  bookingId: string
  startsAt: string
  endsAt: string
  idempotencyKey: string
}

export interface CancelRequest {
  companyId: string
  bookingId: string
  reason: string
  idempotencyKey: string
}

export type BookingErrorCode =
  | "slot_taken"
  | "slot_expired"
  | "hold_not_found"
  | "hold_expired"
  | "booking_not_found"
  | "service_not_found"
  | "outside_working_hours"
  | "provider_unavailable"
  | "not_configured"
  | "rate_limited"
  /** Некорректный запрос (например, пустой companyId) — повтор не поможет. */
  | "invalid_request"

export class BookingError extends Error {
  readonly code: BookingErrorCode
  /** Можно ли повторить операцию. Определяет, уходит ли событие в retry или в dead-letter. */
  readonly retryable: boolean
  constructor(code: BookingErrorCode, message: string, retryable = false) {
    super(message)
    this.name = "BookingError"
    this.code = code
    this.retryable = retryable
  }
}

/**
 * Полный интерфейс провайдера записи. Любая реальная интеграция (altegio, yclients,
 * google calendar) обязана реализовать все методы — частичная реализация ломает диалог
 * в середине записи, что хуже отказа на входе.
 */
export interface BookingProvider {
  readonly name: string
  /** Настроен ли провайдер. false -> режим понижается preflight-гейтом. */
  isConfigured(): boolean

  listServices(companyId: string): Promise<Service[]>
  listStaff(companyId: string): Promise<Staff[]>
  listLocations(companyId: string): Promise<Location[]>

  getAvailability(query: AvailabilityQuery): Promise<Slot[]>
  holdSlot(request: HoldRequest): Promise<Hold>
  releaseHold(companyId: string, holdId: string): Promise<void>
  confirmBooking(request: ConfirmRequest): Promise<BookingRecord>
  rescheduleBooking(request: RescheduleRequest): Promise<BookingRecord>
  cancelBooking(request: CancelRequest): Promise<void>
}

/** Провайдер-заглушка для незаконфигуренного состояния: честно отказывает вместо тихой имитации. */
export class NotConfiguredBookingProvider implements BookingProvider {
  readonly name = "not_configured"
  isConfigured(): boolean {
    return false
  }
  private fail(): never {
    throw new BookingError("not_configured", "Провайдер записи не настроен", false)
  }
  async listServices(): Promise<Service[]> {
    return []
  }
  async listStaff(): Promise<Staff[]> {
    return []
  }
  async listLocations(): Promise<Location[]> {
    return []
  }
  async getAvailability(): Promise<Slot[]> {
    return []
  }
  async holdSlot(): Promise<Hold> {
    this.fail()
  }
  async releaseHold(): Promise<void> {
    this.fail()
  }
  async confirmBooking(): Promise<BookingRecord> {
    this.fail()
  }
  async rescheduleBooking(): Promise<BookingRecord> {
    this.fail()
  }
  async cancelBooking(): Promise<void> {
    this.fail()
  }
}

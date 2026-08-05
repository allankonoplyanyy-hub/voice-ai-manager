// Контракт телефонии и разбор входящего вызова.
//
// Поддерживаются две схемы подключения, выбор — за компанией:
//  - "forwarded": звонок приходит на существующий номер компании, а оператор
//    переадресует его на SIP-адрес ассистента. Номер остаётся у компании.
//  - "rented": номер арендуется у провайдера (Twilio, Telnyx) и сразу указывает
//    на ассистента.
//
// Главный риск этого слоя — не «не дозвонились», а увести звонок в чужую
// компанию: тогда телефон и запись клиента окажутся в чужом кабинете. Поэтому
// номер приводится к канонному виду, а неоднозначное совпадение считается
// ошибкой конфигурации, а не поводом выбрать первого подходящего.

export type TelephonyProviderId = "twilio" | "telnyx"

/** Схема подключения номера. */
export type RoutingKind = "forwarded" | "rented"

export interface TelephonyRouting {
  companyId: string
  kind: RoutingKind
  /** Номер, который набирает клиент. Хранится в каноничном виде E.164. */
  publicNumber: string
  /** Куда оператор переадресует вызов. Только для схемы "forwarded". */
  sipUri: string | null
  /** Провайдер арендованного номера. Только для схемы "rented". */
  provider: TelephonyProviderId | null
}

/** Разобранный входящий вызов, уже привязанный к компании. */
export interface InboundCall {
  companyId: string
  /** Набранный номер компании. */
  toNumber: string
  /** Номер клиента. Может отсутствовать при скрытом определителе. */
  fromNumber: string | null
  providerCallId: string
}

export interface TelephonyProvider {
  /** Разбирает полезную нагрузку вебхука в вызов. */
  parseInbound(payload: unknown): InboundCall | null
  /** Ответ ассистента на входящий вызов. */
  answer(call: InboundCall): Promise<void>
  /** Передача вызова живому менеджеру. */
  transfer(call: InboundCall, destination: string): Promise<void>
}

const MIN_E164_DIGITS = 10
const MAX_E164_DIGITS = 15

/**
 * Приводит номер к каноничному E.164 или возвращает null.
 *
 * Сравнивать номера как строки нельзя: один и тот же номер записывают как
 * "+7 (727) 300-22-33", "87273002233" и "+77273002233". Без приведения к общему
 * виду вебхук не нашёл бы компанию по её же номеру.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null

  let digits = raw.replace(/\D/g, "")
  if (digits.length === 0) return null

  // Междугородний префикс "8" в Казахстане и России соответствует коду +7.
  // Иначе "8 (727) …" и "+7 (727) …" считались бы разными номерами.
  if (digits.length === 11 && digits.startsWith("8")) {
    digits = `7${digits.slice(1)}`
  }

  if (digits.length < MIN_E164_DIGITS || digits.length > MAX_E164_DIGITS) return null

  return `+${digits}`
}

export interface NumberIndex {
  /** Каноничный номер → companyId. */
  byNumber: Map<string, string>
  /** Номера, заявленные более чем одной компанией. */
  collisions: string[]
  /** Записи с номером, который не удалось разобрать. */
  invalid: string[]
}

/**
 * Строит индекс «номер → компания».
 *
 * Конфликт не разрешается «первым подходящим»: если один номер заявлен двумя
 * компаниями, любой выбор с равной вероятностью отдаёт звонок не тому
 * арендатору. Такой номер исключается из индекса и попадает в collisions,
 * чтобы проблему было видно до приёма звонков.
 */
export function buildNumberIndex(routings: TelephonyRouting[]): NumberIndex {
  const byNumber = new Map<string, string>()
  const collisions = new Set<string>()
  const invalid: string[] = []

  for (const r of routings) {
    const number = normalizePhone(r.publicNumber)
    if (!number) {
      invalid.push(r.companyId)
      continue
    }

    const existing = byNumber.get(number)
    if (existing !== undefined && existing !== r.companyId) {
      collisions.add(number)
      continue
    }
    byNumber.set(number, r.companyId)
  }

  for (const number of collisions) byNumber.delete(number)

  return { byNumber, collisions: [...collisions], invalid }
}

/**
 * Определяет компанию по набранному номеру.
 *
 * Возвращает null для неизвестного и для конфликтующего номера. Вызывающий код
 * обязан трактовать null как отказ: приняв звонок «куда-нибудь», система
 * записала бы разговор в чужую историю.
 */
export function resolveCompanyByDialedNumber(index: NumberIndex, dialed: string | null | undefined): string | null {
  const number = normalizePhone(dialed)
  if (!number) return null
  return index.byNumber.get(number) ?? null
}

/**
 * Достаёт набранный номер из полезной нагрузки вебхука.
 *
 * Провайдеры называют это поле по-разному: Twilio присылает "To" на верхнем
 * уровне, Telnyx — "to" внутри data.payload. Читаются только known-поля: брать
 * первый попавшийся номер из тела нельзя, иначе номер клиента можно было бы
 * подставить как номер компании.
 */
export function extractDialedNumber(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null
  const root = payload as Record<string, unknown>

  const candidates: unknown[] = [root.To, root.to, root.toNumber, root.called, root.Called]

  const data = root.data
  if (typeof data === "object" && data !== null) {
    const inner = (data as Record<string, unknown>).payload
    if (typeof inner === "object" && inner !== null) {
      const p = inner as Record<string, unknown>
      candidates.push(p.to, p.To)
    }
  }

  const call = root.call
  if (typeof call === "object" && call !== null) {
    const c = call as Record<string, unknown>
    candidates.push(c.to, c.To)
  }

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue
    const normalized = normalizePhone(candidate)
    if (normalized) return normalized
  }

  return null
}

export interface RoutingReadiness {
  ready: boolean
  /** Чего не хватает для приёма реальных звонков. */
  missing: string[]
}

/**
 * Проверяет, готова ли маршрутизация компании к живым звонкам.
 *
 * Каждая схема требует своего: переадресация бесполезна без SIP-адреса,
 * арендованный номер — без провайдера. Незаполненное поле означает, что звонок
 * упадёт в тишину, поэтому такая настройка не считается готовой.
 */
export function routingReadiness(routing: TelephonyRouting): RoutingReadiness {
  const missing: string[] = []

  if (!normalizePhone(routing.publicNumber)) missing.push("публичный номер")

  if (routing.kind === "forwarded") {
    // Требуется схема sip:, иначе оператору некуда переадресовать вызов.
    if (!routing.sipUri || !/^sips?:[^\s@]+@[^\s@]+$/.test(routing.sipUri)) {
      missing.push("SIP-адрес для переадресации")
    }
  } else if (!routing.provider) {
    missing.push("провайдер арендованного номера")
  }

  return { ready: missing.length === 0, missing }
}

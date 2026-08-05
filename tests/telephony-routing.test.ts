// Маршрутизация номеров: главное свойство — звонок не должен попасть в чужую
// компанию. Проверяются приведение номеров к общему виду, отказ при
// неоднозначности и разбор полезной нагрузки провайдеров.

import { describe, expect, it } from "vitest"
import {
  buildNumberIndex,
  extractDialedNumber,
  normalizePhone,
  resolveCompanyByDialedNumber,
  routingReadiness,
  type TelephonyRouting,
} from "@/lib/voice/providers/telephony"

function routing(over: Partial<TelephonyRouting> & { companyId: string }): TelephonyRouting {
  return {
    kind: "forwarded",
    publicNumber: "+77273002233",
    sipUri: null,
    provider: null,
    ...over,
  }
}

describe("normalizePhone", () => {
  it("приводит записи одного номера к одному виду", () => {
    const expected = "+77273002233"
    for (const raw of ["+7 (727) 300-22-33", "87273002233", "+7-727-300-22-33", " +77273002233 "]) {
      expect(normalizePhone(raw)).toBe(expected)
    }
  })

  it("отклоняет слишком короткие, слишком длинные и пустые значения", () => {
    for (const raw of ["", "   ", "12345", "+7 (727) 300-22-33-44-55-66", "абв", null, undefined]) {
      expect(normalizePhone(raw)).toBeNull()
    }
  })

  it("не превращает 8 в 7 у номеров другой длины", () => {
    // Восьмёрка — междугородний префикс только в 11-значном номере. Для номера
    // другой длины это значащая цифра, и подмена исказила бы номер.
    expect(normalizePhone("8012345678")).toBe("+8012345678")
  })
})

describe("buildNumberIndex", () => {
  it("находит компанию независимо от формата записи номера", () => {
    const index = buildNumberIndex([routing({ companyId: "clinic", publicNumber: "+7 (727) 300-22-33" })])
    expect(resolveCompanyByDialedNumber(index, "87273002233")).toBe("clinic")
  })

  it("исключает номер, заявленный двумя компаниями", () => {
    const index = buildNumberIndex([
      routing({ companyId: "clinic", publicNumber: "+77273002233" }),
      routing({ companyId: "salon", publicNumber: "8 727 300 22 33" }),
    ])

    // Любой выбор здесь с равной вероятностью отдал бы звонок не тому
    // арендатору, поэтому номер не обслуживается вовсе.
    expect(index.collisions).toEqual(["+77273002233"])
    expect(resolveCompanyByDialedNumber(index, "+77273002233")).toBeNull()
  })

  it("повтор одной и той же компании конфликтом не считается", () => {
    const index = buildNumberIndex([
      routing({ companyId: "clinic", publicNumber: "+77273002233" }),
      routing({ companyId: "clinic", publicNumber: "87273002233" }),
    ])
    expect(index.collisions).toEqual([])
    expect(resolveCompanyByDialedNumber(index, "+77273002233")).toBe("clinic")
  })

  it("сообщает о компании с нечитаемым номером", () => {
    const index = buildNumberIndex([routing({ companyId: "broken", publicNumber: "не номер" })])
    expect(index.invalid).toEqual(["broken"])
  })

  it("неизвестный номер не привязывается ни к кому", () => {
    const index = buildNumberIndex([routing({ companyId: "clinic" })])
    expect(resolveCompanyByDialedNumber(index, "+77770000000")).toBeNull()
    expect(resolveCompanyByDialedNumber(index, null)).toBeNull()
  })
})

describe("routingReadiness", () => {
  it("переадресация без SIP-адреса не готова", () => {
    const status = routingReadiness(routing({ companyId: "clinic", kind: "forwarded", sipUri: null }))
    expect(status.ready).toBe(false)
    expect(status.missing).toContain("SIP-адрес для переадресации")
  })

  it("переадресация с корректным SIP готова", () => {
    const status = routingReadiness(
      routing({ companyId: "clinic", kind: "forwarded", sipUri: "sip:assistant@voice.example" }),
    )
    expect(status).toEqual({ ready: true, missing: [] })
  })

  it("строка, не похожая на SIP-адрес, не принимается", () => {
    const status = routingReadiness(
      routing({ companyId: "clinic", kind: "forwarded", sipUri: "не-адрес" }),
    )
    expect(status.ready).toBe(false)
  })

  it("арендованный номер без провайдера не готов", () => {
    const status = routingReadiness(routing({ companyId: "clinic", kind: "rented", provider: null }))
    expect(status.ready).toBe(false)
    expect(status.missing).toContain("провайдер арендованного номера")
  })

  it("арендованный номер с провайдером готов", () => {
    const status = routingReadiness(routing({ companyId: "clinic", kind: "rented", provider: "twilio" }))
    expect(status).toEqual({ ready: true, missing: [] })
  })
})

describe("extractDialedNumber", () => {
  it("читает формат Twilio", () => {
    expect(extractDialedNumber({ To: "+7 (727) 300-22-33", From: "+77015550101" })).toBe("+77273002233")
  })

  it("читает вложенный формат Telnyx", () => {
    expect(extractDialedNumber({ data: { payload: { to: "87273002233" } } })).toBe("+77273002233")
  })

  it("не принимает номер клиента за номер компании", () => {
    // From относится к звонящему. Если бы читалось любое поле с номером,
    // клиент мог бы подставить чужой номер компании и попасть в её кабинет.
    expect(extractDialedNumber({ From: "+77015550101" })).toBeNull()
  })

  it("возвращает null, когда номера нет", () => {
    for (const payload of [{ event: "call.started" }, {}, null, "строка", 42]) {
      expect(extractDialedNumber(payload)).toBeNull()
    }
  })
})

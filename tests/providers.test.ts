import { describe, expect, it } from "vitest"
import {
  createDemoRegistry,
  createMockCalendar,
  createMockCrm,
  createMockHandoff,
  notConfigured,
} from "@/lib/voice/providers"
import { createSignedEnvelope, CONTRACT_VERSION } from "@/lib/voice/contract"
import { verifySignature } from "@/lib/voice/security"

describe("mock-провайдеры (soft-fail)", () => {
  it("CRM-сбой возвращает softFailed, не бросает исключение", () => {
    const crm = createMockCrm({ failNext: true })
    const lead = { id: "l1" } as Parameters<typeof crm.createLead>[0]
    const first = crm.createLead(lead)
    expect(first.ok).toBe(false)
    expect(first.softFailed).toBe(true)
    // retry успешен
    const second = crm.createLead(lead)
    expect(second.ok).toBe(true)
    expect(second.data?.externalId).toContain("l1")
  })

  it("Calendar-сбой возвращает softFailed", () => {
    const cal = createMockCalendar({ failNext: true })
    const slots = cal.findSlots("c1", "узи")
    expect(slots.ok).toBe(false)
    expect(slots.softFailed).toBe(true)
  })

  it("недоступный менеджер — softFailed, без исключений", () => {
    const handoff = createMockHandoff({ managerUnavailable: true })
    const result = handoff.transfer("call-1", "customer_request", "резюме")
    expect(result.ok).toBe(false)
    expect(result.softFailed).toBe(true)
  })

  it("ненастроенный live-провайдер возвращает not_configured", () => {
    const result = notConfigured("Twilio")
    expect(result.status).toBe("not_configured")
    expect(result.softFailed).toBe(true)
  })

  it("demo registry собирается из mock-провайдеров без ошибок", () => {
    const registry = createDemoRegistry()
    expect(registry.telephony.answerCall("p1").ok).toBe(true)
    expect(registry.stt.transcribe("a1").ok).toBe(true)
    expect(registry.tts.synthesize("привет").ok).toBe(true)
    expect(registry.llm.decide({ state: "greeting", lastClientText: "" }).ok).toBe(true)
    expect(registry.messaging.send("sms", "+77010000000", "текст").ok).toBe(true)
  })
})

describe("API-контракт (signed envelope)", () => {
  it("конверт содержит версию, источник и валидную подпись", () => {
    const envelope = createSignedEnvelope({ callId: "c1", type: "voice.lead.created" }, "idem-1")
    expect(envelope.version).toBe(CONTRACT_VERSION)
    expect(envelope.source).toBe("voice-ai-manager")
    expect(verifySignature(JSON.stringify(envelope.body), envelope.timestamp, envelope.signature)).toBe(true)
  })
})

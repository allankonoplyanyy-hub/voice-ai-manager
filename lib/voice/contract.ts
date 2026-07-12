import { signPayload } from "./security"
import type { VoiceEvent } from "./types"

// API-контракт Voice AI Manager → Control Center / CRM.
// Все исходящие события упаковываются в подписанный конверт (envelope):
//   - version: версия контракта;
//   - timestamp: время отправки (replay protection на принимающей стороне);
//   - idempotencyKey: дедупликация на принимающей стороне;
//   - signature: HMAC-SHA256(secret, `${timestamp}.${JSON(body)}`).
//
// Принимающая сторона обязана:
//   1) проверить подпись; 2) проверить окно timestamp; 3) применить идемпотентность.

export const CONTRACT_VERSION = "voice-ai.v1"

export interface SignedEnvelope<T> {
  version: typeof CONTRACT_VERSION
  source: "voice-ai-manager"
  timestamp: string
  idempotencyKey: string
  signature: string
  body: T
}

/** События, отправляемые в Control Center. */
export type ControlCenterEventType = VoiceEvent["type"]

export interface ControlCenterEventBody {
  eventId: string
  companyId: string
  callId: string
  type: ControlCenterEventType
  payload: Record<string, unknown>
}

/** Полезная нагрузка лида для CRM (contract-first). */
export interface CrmLeadBody {
  companyId: string
  callId: string
  name: string
  phone: string
  intent: string
  score: number
  temperature: "hot" | "warm" | "cold"
  managerSummary: string
  nextBestAction: string
  source: "voice_ai"
}

export function createSignedEnvelope<T>(body: T, idempotencyKey: string, now = new Date()): SignedEnvelope<T> {
  const timestamp = now.toISOString()
  const signature = signPayload(JSON.stringify(body), timestamp)
  return {
    version: CONTRACT_VERSION,
    source: "voice-ai-manager",
    timestamp,
    idempotencyKey,
    signature,
    body,
  }
}

export function envelopeForEvent(event: VoiceEvent): SignedEnvelope<ControlCenterEventBody> {
  return createSignedEnvelope(
    {
      eventId: event.eventId,
      companyId: event.companyId,
      callId: event.callId,
      type: event.type,
      payload: event.payload,
    },
    event.idempotencyKey,
    new Date(event.timestamp),
  )
}

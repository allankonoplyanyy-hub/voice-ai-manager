import type { AdapterStatus } from "./types"

// Единые интерфейсы адаптеров. Demo-режим использует только mock-реализации.
// Live-провайдеры (Twilio, Telnyx, OpenAI, ElevenLabs, Google Calendar,
// Bitrix24, AAA CRM, Telegram, WhatsApp) описаны интерфейсами,
// но не активированы: без настройки возвращают status "not_configured".
// Система никогда не падает из-за ненастроенного провайдера.

export interface AdapterResult<T = unknown> {
  status: AdapterStatus
  data: T | null
  provider: string
}

export interface AdapterDescriptor {
  id: string
  name: string
  kind:
    | "telephony"
    | "stt"
    | "tts"
    | "ai_model"
    | "knowledge"
    | "crm"
    | "calendar"
    | "messaging"
    | "manager_transfer"
    | "storage"
    | "analytics"
  kindLabel: string
  mockProvider: string
  liveProviders: string[]
  status: AdapterStatus
  description: string
}

export const ADAPTERS: AdapterDescriptor[] = [
  {
    id: "telephony",
    name: "TelephonyAdapter",
    kind: "telephony",
    kindLabel: "Телефония",
    mockProvider: "Mock Telephony (demo)",
    liveProviders: ["Twilio", "Telnyx"],
    status: "mock",
    description: "Приём входящих звонков и webhook провайдера. В demo-режиме звонки имитируются, реальная телефония не подключена.",
  },
  {
    id: "stt",
    name: "SpeechToTextAdapter",
    kind: "stt",
    kindLabel: "Распознавание речи",
    mockProvider: "Mock STT (скриптовые реплики)",
    liveProviders: ["OpenAI Whisper"],
    status: "mock",
    description: "Преобразование речи клиента в текст. Demo использует заранее подготовленные реплики сценариев.",
  },
  {
    id: "tts",
    name: "TextToSpeechAdapter",
    kind: "tts",
    kindLabel: "Синтез речи",
    mockProvider: "Mock TTS (текстовые ответы)",
    liveProviders: ["ElevenLabs", "OpenAI TTS"],
    status: "mock",
    description: "Озвучивание ответов ассистента. В demo ответы отображаются текстом.",
  },
  {
    id: "ai_model",
    name: "AiModelAdapter",
    kind: "ai_model",
    kindLabel: "AI-модель",
    mockProvider: "Scripted Orchestrator (demo)",
    liveProviders: ["OpenAI GPT"],
    status: "mock",
    description: "Принятие решений в диалоге. Demo-режим использует детерминированные сценарии без платных API.",
  },
  {
    id: "knowledge",
    name: "KnowledgeAdapter",
    kind: "knowledge",
    kindLabel: "База знаний",
    mockProvider: "In-memory Knowledge (demo)",
    liveProviders: ["Vector DB / RAG"],
    status: "mock",
    description: "Company-scoped база знаний: услуги, цены, график, FAQ, правила, запрещённые ответы.",
  },
  {
    id: "crm",
    name: "CrmAdapter",
    kind: "crm",
    kindLabel: "CRM",
    mockProvider: "Mock CRM + Outbox (demo)",
    liveProviders: ["AAA CRM", "Bitrix24"],
    status: "mock",
    description: "Создание лидов и сделок. При сбое CRM лид сохраняется локально, job уходит в outbox с retry.",
  },
  {
    id: "calendar",
    name: "CalendarAdapter",
    kind: "calendar",
    kindLabel: "Календарь",
    mockProvider: "Mock Calendar (реалистичные слоты)",
    liveProviders: ["Google Calendar"],
    status: "mock",
    description: "Свободные слоты, запись, перенос, отмена. При сбое — заявка с желаемой датой для менеджера.",
  },
  {
    id: "messaging",
    name: "MessagingAdapter",
    kind: "messaging",
    kindLabel: "Сообщения",
    mockProvider: "Mock Messaging (события без отправки)",
    liveProviders: ["Telegram", "WhatsApp", "SMS", "Email"],
    status: "mock",
    description: "Follow-up после звонка. В demo наружу ничего не отправляется — создаётся mock-событие.",
  },
  {
    id: "manager_transfer",
    name: "ManagerTransferAdapter",
    kind: "manager_transfer",
    kindLabel: "Передача менеджеру",
    mockProvider: "Mock Transfer (demo)",
    liveProviders: ["Twilio Dial", "SIP"],
    status: "mock",
    description: "Handoff сложных звонков менеджеру с указанием причины и резюме разговора.",
  },
  {
    id: "storage",
    name: "StorageAdapter",
    kind: "storage",
    kindLabel: "Хранилище",
    mockProvider: "In-memory Store (demo)",
    liveProviders: ["PostgreSQL"],
    status: "mock",
    description: "Хранение звонков, лидов, записей и событий. Demo — in-memory, live — PostgreSQL.",
  },
  {
    id: "analytics",
    name: "AnalyticsAdapter",
    kind: "analytics",
    kindLabel: "Аналитика",
    mockProvider: "Computed Metrics (demo)",
    liveProviders: ["Control Center Events"],
    status: "mock",
    description: "Метрики рассчитываются из реальных demo-звонков store — без случайных значений.",
  },
]

// Вызов ненастроенного live-провайдера: единый безопасный ответ.
export function callLiveProvider(provider: string): AdapterResult {
  return { status: "not_configured", data: null, provider }
}

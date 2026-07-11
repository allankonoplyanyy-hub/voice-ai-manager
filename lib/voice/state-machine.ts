import type { CallState } from "./types"

// Строгая карта разрешённых переходов состояний звонка.
// Любой переход, отсутствующий в карте, отклоняется.

const TERMINAL_STATES: CallState[] = [
  "completed",
  "manager_handoff",
  "no_answer",
  "abandoned",
  "rejected",
  "provider_failed",
  "cost_limit_reached",
]

const ALT_FROM_ACTIVE: CallState[] = [
  "manager_handoff",
  "abandoned",
  "rejected",
  "provider_failed",
  "cost_limit_reached",
]

export const ALLOWED_TRANSITIONS: Record<CallState, CallState[]> = {
  received: ["greeting", "no_answer", "provider_failed", "abandoned"],
  greeting: ["consent", ...ALT_FROM_ACTIVE],
  consent: ["identifying_intent", "rejected", ...ALT_FROM_ACTIVE],
  // lead_capture напрямую: клиент сам называет контакты сразу после определения намерения
  identifying_intent: ["consulting", "qualifying", "lead_capture", ...ALT_FROM_ACTIVE],
  // follow_up напрямую из consulting: консультация существующего клиента без сбора лида
  // lead_capture напрямую из consulting: контакты собираются сразу после консультации
  // follow_up/completed напрямую: консультация существующего клиента без сбора лида
  consulting: ["qualifying", "lead_capture", "consulting", "identifying_intent", "follow_up", "completed", ...ALT_FROM_ACTIVE],
  qualifying: ["lead_capture", "consulting", ...ALT_FROM_ACTIVE],
  lead_capture: ["booking", "follow_up", ...ALT_FROM_ACTIVE],
  booking: ["follow_up", "completed", ...ALT_FROM_ACTIVE],
  follow_up: ["completed", ...ALT_FROM_ACTIVE],
  completed: [],
  manager_handoff: [],
  no_answer: [],
  abandoned: [],
  rejected: [],
  provider_failed: [],
  cost_limit_reached: [],
}

export function isTerminal(state: CallState): boolean {
  return TERMINAL_STATES.includes(state)
}

export function canTransition(from: CallState, to: CallState): boolean {
  if (from === to) return false
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

export class InvalidTransitionError extends Error {
  constructor(from: CallState, to: CallState) {
    super(`Запрещённый переход состояния: ${from} → ${to}`)
    this.name = "InvalidTransitionError"
  }
}

export function assertTransition(from: CallState, to: CallState): void {
  if (isTerminal(from)) {
    throw new InvalidTransitionError(from, to)
  }
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to)
  }
}

export const STATE_LABELS: Record<CallState, string> = {
  received: "Звонок принят",
  greeting: "Приветствие",
  consent: "Согласие",
  identifying_intent: "Определение намерения",
  consulting: "Консультация",
  qualifying: "Квалификация",
  lead_capture: "Сбор контактов",
  booking: "Запись",
  follow_up: "Follow-up",
  completed: "Завершён",
  manager_handoff: "Передан менеджеру",
  no_answer: "Нет ответа",
  abandoned: "Прерван клиентом",
  rejected: "Отказ от обработки",
  provider_failed: "Сбой провайдера",
  cost_limit_reached: "Лимит стоимости",
}

export const HAPPY_PATH: CallState[] = [
  "received",
  "greeting",
  "consent",
  "identifying_intent",
  "consulting",
  "qualifying",
  "lead_capture",
  "booking",
  "follow_up",
  "completed",
]

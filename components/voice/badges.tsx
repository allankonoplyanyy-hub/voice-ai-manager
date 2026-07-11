import { cn } from "@/lib/utils"
import { STATE_LABELS } from "@/lib/voice/state-machine"
import type { CallOutcome, CallState } from "@/lib/voice/types"

const GOOD_STATES: CallState[] = ["completed"]
const BAD_STATES: CallState[] = ["provider_failed", "cost_limit_reached", "no_answer"]
const NEUTRAL_ALT: CallState[] = ["manager_handoff", "abandoned", "rejected"]

export function StateBadge({ state }: { state: CallState }) {
  const cls = GOOD_STATES.includes(state)
    ? "bg-success/10 text-success"
    : BAD_STATES.includes(state)
      ? "bg-destructive/10 text-destructive"
      : NEUTRAL_ALT.includes(state)
        ? "bg-accent text-accent-foreground"
        : "bg-muted text-muted-foreground"
  return (
    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", cls)}>
      {STATE_LABELS[state]}
    </span>
  )
}

export const OUTCOME_LABELS: Record<CallOutcome, string> = {
  lead_created: "Лид создан",
  booking_created: "Запись создана",
  handoff: "Передан менеджеру",
  info_only: "Консультация",
  no_answer: "Нет ответа",
  abandoned: "Прерван",
  rejected: "Отказ",
  failed: "Сбой",
}

export function OutcomeBadge({ outcome }: { outcome: CallOutcome }) {
  const cls =
    outcome === "lead_created" || outcome === "booking_created"
      ? "bg-success/10 text-success"
      : outcome === "failed"
        ? "bg-destructive/10 text-destructive"
        : outcome === "handoff"
          ? "bg-accent text-accent-foreground"
          : "bg-muted text-muted-foreground"
  return (
    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", cls)}>
      {OUTCOME_LABELS[outcome]}
    </span>
  )
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

// Инструментация латентности по стадиям турна.
// Считаем не только полный турн, но и каждую стадию отдельно — иначе при регрессии
// невозможно понять, тормозит STT, LLM или TTS.

export type LatencyStage =
  | "vad_end"
  | "stt_partial"
  | "stt_final"
  | "knowledge"
  | "llm_first_token"
  | "llm_complete"
  | "tts_first_audio"
  | "first_audio_delivered"
  | "booking_provider"
  | "handoff"

/** Бюджеты стадий в мс. Источник целевых значений для алертов и тестов. */
export const LATENCY_BUDGET_MS: Record<LatencyStage, number> = {
  vad_end: 300,
  stt_partial: 400,
  stt_final: 900,
  knowledge: 250,
  llm_first_token: 700,
  llm_complete: 1800,
  tts_first_audio: 500,
  first_audio_delivered: 1500,
  booking_provider: 1200,
  handoff: 2000,
}

/** Целевая граница полного турна: от конца речи клиента до первого аудио ответа. */
export const FULL_TURN_BUDGET_MS = 2500

export interface TurnMetrics {
  callId: string
  companyId: string
  turnIndex: number
  mode: string
  stages: Partial<Record<LatencyStage, number>>
  fullTurnMs?: number
  interrupted: boolean
  interruptionHandled: boolean
  emptyTranscript: boolean
  fallbackUsed: boolean
}

/**
 * Таймер турна. Все стадии измеряются от единой точки t0 (конец речи клиента),
 * поэтому значения сопоставимы между собой и с бюджетами.
 */
export class TurnTimer {
  private readonly t0: number
  private readonly stages: Partial<Record<LatencyStage, number>> = {}
  private readonly clock: () => number
  private ended = false

  readonly callId: string
  readonly companyId: string
  readonly turnIndex: number
  readonly mode: string

  interrupted = false
  interruptionHandled = false
  emptyTranscript = false
  fallbackUsed = false

  constructor(params: {
    callId: string
    companyId: string
    turnIndex: number
    mode: string
    clock?: () => number
  }) {
    this.callId = params.callId
    this.companyId = params.companyId
    this.turnIndex = params.turnIndex
    this.mode = params.mode
    this.clock = params.clock ?? (() => Date.now())
    this.t0 = this.clock()
  }

  /** Фиксирует стадию. Повторный вызов игнорируется — первая отметка честнее. */
  mark(stage: LatencyStage): number {
    const elapsed = this.clock() - this.t0
    if (this.stages[stage] === undefined) this.stages[stage] = elapsed
    return elapsed
  }

  /** Измеряет асинхронную операцию и отмечает стадию по её завершении. */
  async measure<T>(stage: LatencyStage, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } finally {
      this.mark(stage)
    }
  }

  get elapsedMs(): number {
    return this.clock() - this.t0
  }

  end(): TurnMetrics {
    const fullTurnMs = this.stages.first_audio_delivered ?? this.clock() - this.t0
    this.ended = true
    return {
      callId: this.callId,
      companyId: this.companyId,
      turnIndex: this.turnIndex,
      mode: this.mode,
      stages: { ...this.stages },
      fullTurnMs,
      interrupted: this.interrupted,
      interruptionHandled: this.interruptionHandled,
      emptyTranscript: this.emptyTranscript,
      fallbackUsed: this.fallbackUsed,
    }
  }

  get isEnded(): boolean {
    return this.ended
  }
}

export interface BudgetViolation {
  stage: LatencyStage | "full_turn"
  actualMs: number
  budgetMs: number
  overByMs: number
}

/** Возвращает стадии, вышедшие за бюджет. Пустой массив — всё в норме. */
export function checkBudgets(metrics: TurnMetrics): BudgetViolation[] {
  const violations: BudgetViolation[] = []
  for (const [stage, actual] of Object.entries(metrics.stages) as [LatencyStage, number][]) {
    const budget = LATENCY_BUDGET_MS[stage]
    if (budget !== undefined && actual > budget) {
      violations.push({ stage, actualMs: actual, budgetMs: budget, overByMs: actual - budget })
    }
  }
  if (metrics.fullTurnMs !== undefined && metrics.fullTurnMs > FULL_TURN_BUDGET_MS) {
    violations.push({
      stage: "full_turn",
      actualMs: metrics.fullTurnMs,
      budgetMs: FULL_TURN_BUDGET_MS,
      overByMs: metrics.fullTurnMs - FULL_TURN_BUDGET_MS,
    })
  }
  return violations
}

export interface LatencyPercentiles {
  count: number
  p50: number
  p95: number
  p99: number
  max: number
}

/** Перцентили по методу nearest-rank. Для пустого набора возвращает нули. */
export function percentiles(values: number[]): LatencyPercentiles {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (clean.length === 0) return { count: 0, p50: 0, p95: 0, p99: 0, max: 0 }
  const at = (p: number) => clean[Math.min(clean.length - 1, Math.ceil((p / 100) * clean.length) - 1)]
  return { count: clean.length, p50: at(50), p95: at(95), p99: at(99), max: clean[clean.length - 1] }
}

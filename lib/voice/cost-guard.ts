import type { VoiceCall, VoiceTenant } from "./types"

// Cost guard: ограничение стоимости и длительности звонка per-tenant.
// При превышении лимита звонок переводится в терминальное состояние
// cost_limit_reached, а не продолжает тратить бюджет.

export interface CostCheckResult {
  exceeded: boolean
  reason: "cost" | "duration" | null
  limitTenge: number
  limitDurationSec: number
  currentCostTenge: number
  currentDurationSec: number
}

export function checkCostGuard(
  call: Pick<VoiceCall, "costTenge" | "durationSec">,
  tenant: Pick<VoiceTenant, "maxCallCostTenge" | "maxCallDurationSec">,
): CostCheckResult {
  const base: CostCheckResult = {
    exceeded: false,
    reason: null,
    limitTenge: tenant.maxCallCostTenge,
    limitDurationSec: tenant.maxCallDurationSec,
    currentCostTenge: call.costTenge,
    currentDurationSec: call.durationSec,
  }
  if (call.costTenge > tenant.maxCallCostTenge) {
    return { ...base, exceeded: true, reason: "cost" }
  }
  if (call.durationSec > tenant.maxCallDurationSec) {
    return { ...base, exceeded: true, reason: "duration" }
  }
  return base
}

/** Стоимость шага диалога в тенге (demo-тариф, детерминированный). */
export const COST_PER_STEP_TENGE = 5

export function estimateStepCost(stepDurationSec: number): number {
  return Math.round(stepDurationSec * 0.35)
}

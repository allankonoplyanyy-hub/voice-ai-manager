import type { FollowUp, VoiceCall } from "./types"

// Чистые вычисления над уже загруженными данными: функции принимают звонки и
// follow-up, а не обращаются к хранилищу сами. Так расчёт метрик не зависит от
// источника (БД, тест, фикстура) и тестируется без базы.

export interface VoiceMetrics {
  period: "today" | "7d" | "30d"
  totalCalls: number
  answered: number
  missed: number
  completed: number
  handoffs: number
  leads: number
  bookings: number
  conversionPct: number // лиды / отвеченные
  avgDurationSec: number
  followUpsSent: number
  totalCostTenge: number
  outcomes: { outcome: string; count: number }[]
  topIntents: { intent: string; count: number }[]
  unansweredQuestions: string[]
}

function inPeriod(call: VoiceCall, period: VoiceMetrics["period"], now: Date): boolean {
  const started = new Date(call.startedAt)
  if (period === "today") {
    return started.toDateString() === now.toDateString()
  }
  const days = period === "7d" ? 7 : 30
  return now.getTime() - started.getTime() <= days * 86400_000
}

export function computeMetrics(
  period: VoiceMetrics["period"],
  source: VoiceCall[],
  followUpsSource: FollowUp[] = [],
  now: Date = new Date(),
): VoiceMetrics {
  const calls = source.filter((c) => inPeriod(c, period, now))

  const answered = calls.filter((c) => c.state !== "no_answer" && c.state !== "provider_failed")
  const missed = calls.length - answered.length
  const completed = calls.filter((c) => c.state === "completed")
  const handoffs = calls.filter((c) => c.handoff !== null)
  const leads = calls.filter((c) => c.leadId !== null)
  const bookings = calls.filter((c) => c.bookingId !== null)

  const callIds = new Set(calls.map((c) => c.callId))
  const followUpsSent = followUpsSource.filter(
    (f) => callIds.has(f.callId) && f.status === "sent_mock",
  ).length

  const outcomeCounts = new Map<string, number>()
  for (const c of calls) {
    outcomeCounts.set(c.outcome, (outcomeCounts.get(c.outcome) ?? 0) + 1)
  }

  const intentCounts = new Map<string, number>()
  for (const c of calls) {
    if (c.intent) intentCounts.set(c.intent, (intentCounts.get(c.intent) ?? 0) + 1)
  }

  const unanswered = calls.flatMap((c) => c.unansweredQuestions)

  return {
    period,
    totalCalls: calls.length,
    answered: answered.length,
    missed,
    completed: completed.length,
    handoffs: handoffs.length,
    leads: leads.length,
    bookings: bookings.length,
    conversionPct:
      answered.length > 0 ? Math.round((leads.length / answered.length) * 100) : 0,
    avgDurationSec:
      calls.length > 0
        ? Math.round(calls.reduce((s, c) => s + c.durationSec, 0) / calls.length)
        : 0,
    followUpsSent,
    totalCostTenge: calls.reduce((s, c) => s + c.costTenge, 0),
    outcomes: [...outcomeCounts.entries()]
      .map(([outcome, count]) => ({ outcome, count }))
      .sort((a, b) => b.count - a.count),
    topIntents: [...intentCounts.entries()]
      .map(([intent, count]) => ({ intent, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
    unansweredQuestions: unanswered,
  }
}

export function callsPerDay(
  days: number,
  source: VoiceCall[],
  now: Date = new Date(),
): { date: string; calls: number; leads: number }[] {
  const result: { date: string; calls: number; leads: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    const dayCalls = source.filter((c) => c.startedAt.slice(0, 10) === key)
    result.push({
      date: key,
      calls: dayCalls.length,
      leads: dayCalls.filter((c) => c.leadId !== null).length,
    })
  }
  return result
}

"use client"

import { useState } from "react"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import type { VoiceMetrics } from "@/lib/voice/analytics"
import { OUTCOME_LABELS, formatDuration } from "@/components/voice/badges"
import { cn } from "@/lib/utils"

type PeriodKey = "today" | "week" | "month"

const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: "Сегодня",
  week: "7 дней",
  month: "30 дней",
}

export function AnalyticsView({
  overall,
  daily,
  perCompany,
}: {
  overall: Record<PeriodKey, VoiceMetrics>
  daily: { date: string; calls: number; leads: number }[]
  perCompany: { companyId: string; name: string; metrics: VoiceMetrics }[]
}) {
  const [period, setPeriod] = useState<PeriodKey>("month")
  const m = overall[period]

  const chartData = daily.map((d) => ({
    ...d,
    label: new Date(d.date).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }),
  }))

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Аналитика</h1>
        <p className="text-sm text-muted-foreground">
          Все метрики рассчитаны из demo-звонков — без случайных значений.
        </p>
      </header>

      <div className="flex gap-2" role="tablist" aria-label="Период">
        {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={period === p}
            onClick={() => setPeriod(p)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm",
              period === p
                ? "border-gold bg-accent font-medium"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Звонки", value: String(m.totalCalls) },
          { label: "Отвечено", value: String(m.answered) },
          { label: "Лиды", value: String(m.leads) },
          { label: "Записи", value: String(m.bookings) },
          { label: "Конверсия", value: `${m.conversionPct}%` },
          { label: "Передачи менеджеру", value: String(m.handoffs) },
          { label: "Ср. длительность", value: formatDuration(m.avgDurationSec) },
          { label: "Стоимость", value: `${m.totalCostTenge.toLocaleString("ru-RU")} ₸` },
        ].map((card) => (
          <div key={card.label} className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4">
            <span className="text-xs text-muted-foreground">{card.label}</span>
            <span className="text-2xl font-semibold">{card.value}</span>
          </div>
        ))}
      </div>

      <section aria-label="Звонки по дням" className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-4 text-sm font-semibold">Звонки и лиды за 14 дней</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="var(--color-muted-foreground)" />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="var(--color-muted-foreground)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--color-card)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "8px",
                  fontSize: "13px",
                }}
              />
              <Legend wrapperStyle={{ fontSize: "13px" }} />
              <Bar dataKey="calls" name="Звонки" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="leads" name="Лиды" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section aria-label="Результаты звонков" className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Результаты звонков ({PERIOD_LABELS[period]})</h2>
          <ul className="flex flex-col gap-2">
            {m.outcomes.map((o) => (
              <li key={o.outcome} className="flex items-center gap-3">
                <span className="w-40 shrink-0 text-sm text-muted-foreground">
                  {OUTCOME_LABELS[o.outcome as keyof typeof OUTCOME_LABELS] ?? o.outcome}
                </span>
                <div className="h-2 flex-1 rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-gold"
                    style={{ width: `${m.totalCalls > 0 ? (o.count / m.totalCalls) * 100 : 0}%` }}
                  />
                </div>
                <span className="w-6 text-right text-sm tabular-nums">{o.count}</span>
              </li>
            ))}
            {m.outcomes.length === 0 && <li className="text-sm text-muted-foreground">Нет данных за период.</li>}
          </ul>
        </section>

        <section aria-label="Популярные запросы" className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Популярные запросы</h2>
          <ul className="flex flex-col gap-2">
            {m.topIntents.map((intent) => (
              <li key={intent.intent} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{intent.intent}</span>
                <span className="tabular-nums text-muted-foreground">{intent.count}</span>
              </li>
            ))}
            {m.topIntents.length === 0 && <li className="text-sm text-muted-foreground">Нет данных за период.</li>}
          </ul>
          {m.unansweredQuestions.length > 0 && (
            <div className="mt-4 rounded-lg bg-muted p-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Вопросы без ответа (кандидаты в базу знаний):
              </p>
              <ul className="list-inside list-disc text-sm">
                {m.unansweredQuestions.slice(0, 5).map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      <section aria-label="По компаниям" className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">По компаниям (30 дней)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Компания</th>
                <th className="py-2 pr-4 font-medium">Звонки</th>
                <th className="py-2 pr-4 font-medium">Лиды</th>
                <th className="py-2 pr-4 font-medium">Записи</th>
                <th className="py-2 pr-4 font-medium">Конверсия</th>
                <th className="py-2 font-medium">Стоимость</th>
              </tr>
            </thead>
            <tbody>
              {perCompany.map((c) => (
                <tr key={c.companyId} className="border-b border-border last:border-0">
                  <td className="py-2 pr-4">{c.name}</td>
                  <td className="py-2 pr-4 tabular-nums">{c.metrics.totalCalls}</td>
                  <td className="py-2 pr-4 tabular-nums">{c.metrics.leads}</td>
                  <td className="py-2 pr-4 tabular-nums">{c.metrics.bookings}</td>
                  <td className="py-2 pr-4 tabular-nums">{c.metrics.conversionPct}%</td>
                  <td className="py-2 tabular-nums">{c.metrics.totalCostTenge.toLocaleString("ru-RU")} ₸</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

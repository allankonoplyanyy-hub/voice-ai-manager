"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { Search } from "lucide-react"
import type { CallOutcome, CallState } from "@/lib/voice/types"
import { OUTCOME_LABELS, OutcomeBadge, StateBadge, formatDateTime, formatDuration } from "@/components/voice/badges"

export interface CallRow {
  callId: string
  companyId: string
  clientName: string | null
  clientPhone: string
  startedAt: string
  durationSec: number
  state: CallState
  outcome: CallOutcome
  intent: string | null
  hasLead: boolean
  hasBooking: boolean
  hasHandoff: boolean
}

export function CallsList({
  calls,
  tenants,
}: {
  calls: CallRow[]
  tenants: { companyId: string; name: string }[]
}) {
  const [company, setCompany] = useState<string>("all")
  const [outcome, setOutcome] = useState<string>("all")
  const [query, setQuery] = useState("")

  const tenantName = useMemo(
    () => new Map(tenants.map((t) => [t.companyId, t.name])),
    [tenants],
  )

  const filtered = useMemo(
    () =>
      calls.filter((c) => {
        if (company !== "all" && c.companyId !== company) return false
        if (outcome !== "all" && c.outcome !== outcome) return false
        if (query) {
          const q = query.toLowerCase()
          const hay = `${c.clientName ?? ""} ${c.clientPhone} ${c.intent ?? ""}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
        return true
      }),
    [calls, company, outcome, query],
  )

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Звонки</h1>
        <p className="text-sm text-muted-foreground">
          Все обработанные звонки по всем компаниям. Фильтруйте по компании и результату.
        </p>
      </header>

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <label className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Поиск по имени, телефону или запросу</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск: имя, телефон, запрос…"
            className="w-full rounded-lg border border-input bg-card py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">Компания</span>
          <select
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="rounded-lg border border-input bg-card px-3 py-2 text-sm"
          >
            <option value="all">Все компании</option>
            {tenants.map((t) => (
              <option key={t.companyId} value={t.companyId}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">Результат</span>
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            className="rounded-lg border border-input bg-card px-3 py-2 text-sm"
          >
            <option value="all">Все результаты</option>
            {Object.entries(OUTCOME_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-xs text-muted-foreground">
        Показано {filtered.length} из {calls.length}
      </p>

      <ul className="flex flex-col gap-2">
        {filtered.map((c) => (
          <li key={c.callId}>
            <Link
              href={`/calls/${c.callId}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card p-4 transition-colors hover:border-gold/50"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-medium">
                  {c.clientName ?? "Неизвестный клиент"}{" "}
                  <span className="font-normal text-muted-foreground">{c.clientPhone}</span>
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {tenantName.get(c.companyId)} {c.intent ? `· ${c.intent}` : ""}
                </span>
              </div>
              <StateBadge state={c.state} />
              <OutcomeBadge outcome={c.outcome} />
              <span className="text-xs tabular-nums text-muted-foreground">{formatDuration(c.durationSec)}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{formatDateTime(c.startedAt)}</span>
            </Link>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Ничего не найдено. Измените фильтры.
          </li>
        )}
      </ul>
    </div>
  )
}

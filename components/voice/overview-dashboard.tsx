import Link from "next/link"
import { ArrowRight, CalendarCheck, Phone, PhoneForwarded, Timer, TrendingUp, Users } from "lucide-react"
import { computeMetrics } from "@/lib/voice/analytics"
import { ensureSeeded, listAllCalls, listAllFollowUps, listAllLeads } from "@/lib/voice/persist"
import { DEMO_TENANTS, getTenant } from "@/lib/voice/tenants"
import { OutcomeBadge, StateBadge, formatDateTime, formatDuration } from "@/components/voice/badges"

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="text-2xl font-semibold text-card-foreground">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export async function OverviewDashboard() {
  await ensureSeeded()
  const [calls, leads, followUps] = await Promise.all([
    listAllCalls(),
    listAllLeads(),
    listAllFollowUps(),
  ])
  const today = computeMetrics("today", calls, followUps)
  const week = computeMetrics("7d", calls, followUps)
  const recentCalls = calls.slice(0, 6)
  const recentLeads = leads.slice(0, 5)

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-balance">Обзор</h1>
        <p className="text-sm text-muted-foreground">
          Голосовой AI-администратор: сводка по всем компаниям за сегодня и 7 дней.
        </p>
      </header>

      <section aria-label="Метрики за сегодня" className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Сегодня</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <StatCard icon={Phone} label="Звонки" value={String(today.totalCalls)} hint={`отвечено: ${today.answered}`} />
          <StatCard icon={Users} label="Лиды" value={String(today.leads)} />
          <StatCard icon={CalendarCheck} label="Записи" value={String(today.bookings)} />
          <StatCard icon={PhoneForwarded} label="Передачи" value={String(today.handoffs)} />
          <StatCard icon={TrendingUp} label="Конверсия" value={`${today.conversionPct}%`} hint="лиды / отвеченные" />
          <StatCard icon={Timer} label="Ср. длительность" value={formatDuration(today.avgDurationSec)} />
        </div>
      </section>

      <section aria-label="Метрики за 7 дней" className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Последние 7 дней</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <StatCard icon={Phone} label="Звонки" value={String(week.totalCalls)} hint={`пропущено: ${week.missed}`} />
          <StatCard icon={Users} label="Лиды" value={String(week.leads)} />
          <StatCard icon={CalendarCheck} label="Записи" value={String(week.bookings)} />
          <StatCard icon={PhoneForwarded} label="Передачи" value={String(week.handoffs)} />
          <StatCard icon={TrendingUp} label="Конверсия" value={`${week.conversionPct}%`} />
          <StatCard icon={Timer} label="Стоимость" value={`${week.totalCostTenge.toLocaleString("ru-RU")} ₸`} />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section aria-label="Последние звонки" className="lg:col-span-2 flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Последние звонки</h2>
            <Link href="/calls" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              Все звонки <ArrowRight className="size-3" aria-hidden="true" />
            </Link>
          </div>
          <ul className="flex flex-col divide-y divide-border">
            {recentCalls.map((call) => {
              const tenant = getTenant(call.companyId)
              return (
                <li key={call.callId}>
                  <Link
                    href={`/calls/${call.callId}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 hover:bg-muted/50 rounded-md px-2 -mx-2"
                  >
                    <span className="text-sm font-medium min-w-0 flex-1 truncate">
                      {call.clientName ?? call.clientPhone}
                    </span>
                    <span className="text-xs text-muted-foreground hidden md:inline truncate max-w-40">
                      {tenant?.name}
                    </span>
                    <StateBadge state={call.state} />
                    <OutcomeBadge outcome={call.outcome} />
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatDateTime(call.startedAt)}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>

        <section aria-label="Последние лиды" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Свежие лиды</h2>
          <ul className="flex flex-col divide-y divide-border">
            {recentLeads.map((lead) => (
              <li key={lead.id} className="flex flex-col gap-1 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{lead.name}</span>
                  <span
                    className={
                      lead.temperature === "hot"
                        ? "text-xs font-medium text-destructive"
                        : lead.temperature === "warm"
                          ? "text-xs font-medium text-gold"
                          : "text-xs font-medium text-muted-foreground"
                    }
                  >
                    {lead.temperature === "hot" ? "Горячий" : lead.temperature === "warm" ? "Тёплый" : "Холодный"} · {lead.score}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{lead.interest}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-label="Компании" className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Подключённые компании ({DEMO_TENANTS.length})</h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {DEMO_TENANTS.map((t) => (
            <Link
              key={t.companyId}
              href={`/assistants#${t.companyId}`}
              className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 hover:border-gold/50 transition-colors"
            >
              <span className="text-sm font-medium">{t.name}</span>
              <span className="text-xs text-muted-foreground">
                {t.industry} · {t.phoneNumber}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

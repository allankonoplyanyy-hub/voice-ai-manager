import { AppShell } from "@/components/app-shell"
import { AnalyticsView } from "@/components/voice/analytics-view"
import { callsPerDay, computeMetrics } from "@/lib/voice/analytics"
import { requirePageAuth } from "@/lib/require-page-auth"
import { ensureSeeded, listCallsByCompany, listFollowUpsByCompany } from "@/lib/voice/persist"
import { getTenant } from "@/lib/voice/tenants"

export const metadata = { title: "Аналитика — AAA Voice AI Manager" }

// Метрики считаются из базы: страница обязана рендериться на каждый запрос,
// иначе показывала бы срез на момент сборки.
export const dynamic = "force-dynamic"

export default async function AnalyticsPage() {
  const { companyId } = await requirePageAuth()
  await ensureSeeded()
  // Данные читаются один раз и считаются в памяти, но только по своей компании:
  // сравнение с другими клиентами сервиса раскрывало бы их показатели.
  const [calls, followUps] = await Promise.all([
    listCallsByCompany(companyId),
    listFollowUpsByCompany(companyId),
  ])

  const overall = {
    today: computeMetrics("today", calls, followUps),
    week: computeMetrics("7d", calls, followUps),
    month: computeMetrics("30d", calls, followUps),
  }
  const daily = callsPerDay(14, calls)
  const tenant = getTenant(companyId)
  const perCompany = [
    {
      companyId,
      name: tenant?.name ?? companyId,
      metrics: computeMetrics("30d", calls, followUps),
    },
  ]

  return (
    <AppShell>
      <AnalyticsView overall={overall} daily={daily} perCompany={perCompany} />
    </AppShell>
  )
}

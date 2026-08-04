import { AppShell } from "@/components/app-shell"
import { AnalyticsView } from "@/components/voice/analytics-view"
import { callsPerDay, computeMetrics } from "@/lib/voice/analytics"
import { ensureSeeded, listAllCalls, listAllFollowUps } from "@/lib/voice/persist"
import { DEMO_TENANTS } from "@/lib/voice/tenants"

export const metadata = { title: "Аналитика — AAA Voice AI Manager" }

export default async function AnalyticsPage() {
  await ensureSeeded()
  // Данные читаются один раз, метрики считаются в памяти: так по компаниям не
  // уходит запрос на каждого арендатора.
  const [calls, followUps] = await Promise.all([listAllCalls(), listAllFollowUps()])

  const overall = {
    today: computeMetrics("today", calls, followUps),
    week: computeMetrics("7d", calls, followUps),
    month: computeMetrics("30d", calls, followUps),
  }
  const daily = callsPerDay(14, calls)
  const perCompany = DEMO_TENANTS.map((t) => ({
    companyId: t.companyId,
    name: t.name,
    metrics: computeMetrics(
      "30d",
      calls.filter((c) => c.companyId === t.companyId),
      followUps,
    ),
  }))

  return (
    <AppShell>
      <AnalyticsView overall={overall} daily={daily} perCompany={perCompany} />
    </AppShell>
  )
}

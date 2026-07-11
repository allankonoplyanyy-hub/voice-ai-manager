import { AppShell } from "@/components/app-shell"
import { AnalyticsView } from "@/components/voice/analytics-view"
import { callsPerDay, computeMetrics } from "@/lib/voice/analytics"
import { DEMO_TENANTS } from "@/lib/voice/tenants"

export const metadata = { title: "Аналитика — AAA Voice AI Manager" }

export default function AnalyticsPage() {
  // Метрики по всем компаниям и по каждой отдельно — рассчитаны из demo-звонков
  const overall = {
    today: computeMetrics("today"),
    week: computeMetrics("7d"),
    month: computeMetrics("30d"),
  }
  const daily = callsPerDay(14)
  const perCompany = DEMO_TENANTS.map((t) => ({
    companyId: t.companyId,
    name: t.name,
    metrics: computeMetrics("30d", t.companyId),
  }))

  return (
    <AppShell>
      <AnalyticsView overall={overall} daily={daily} perCompany={perCompany} />
    </AppShell>
  )
}

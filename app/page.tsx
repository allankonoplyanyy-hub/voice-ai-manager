import { AppShell } from "@/components/app-shell"
import { OverviewDashboard } from "@/components/voice/overview-dashboard"
import { requirePageAuth } from "@/lib/require-page-auth"

// Дашборд читает звонки из базы. Без этого Next пререндерил бы страницу на
// сборке и показывал бы данные, замороженные на момент деплоя.
export const dynamic = "force-dynamic"

export default async function Page() {
  const { companyId } = await requirePageAuth()
  return (
    <AppShell>
      <OverviewDashboard companyId={companyId} />
    </AppShell>
  )
}

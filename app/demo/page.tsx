import { AppShell } from "@/components/app-shell"
import { LiveDemo } from "@/components/voice/live-demo"
import { requirePageAuth } from "@/lib/require-page-auth"
import { DEMO_SCENARIOS } from "@/lib/voice/scenarios"
import { getTenant } from "@/lib/voice/tenants"

export const metadata = { title: "Live Demo — AAA Voice AI Manager" }

export const dynamic = "force-dynamic"

export default async function DemoPage() {
  const { companyId } = await requirePageAuth()
  const own = getTenant(companyId)
  const tenants = own ? [{ companyId: own.companyId, name: own.name }] : []
  const scenarios = DEMO_SCENARIOS.filter((s) => s.companyId === companyId)
  return (
    <AppShell>
      <LiveDemo scenarios={scenarios} tenants={tenants} />
    </AppShell>
  )
}

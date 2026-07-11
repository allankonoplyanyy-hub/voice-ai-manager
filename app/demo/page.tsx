import { AppShell } from "@/components/app-shell"
import { LiveDemo } from "@/components/voice/live-demo"
import { DEMO_SCENARIOS } from "@/lib/voice/scenarios"
import { DEMO_TENANTS } from "@/lib/voice/tenants"

export const metadata = { title: "Live Demo — AAA Voice AI Manager" }

export default function DemoPage() {
  const tenants = DEMO_TENANTS.map((t) => ({ companyId: t.companyId, name: t.name }))
  return (
    <AppShell>
      <LiveDemo scenarios={DEMO_SCENARIOS} tenants={tenants} />
    </AppShell>
  )
}

import { AppShell } from "@/components/app-shell"
import { KnowledgeBrowser } from "@/components/voice/knowledge-browser"
import { DEMO_KNOWLEDGE, DEMO_TENANTS } from "@/lib/voice/tenants"

export const metadata = { title: "База знаний — AAA Voice AI Manager" }

export default function KnowledgePage() {
  const tenants = DEMO_TENANTS.map((t) => ({ companyId: t.companyId, name: t.name }))
  return (
    <AppShell>
      <KnowledgeBrowser documents={DEMO_KNOWLEDGE} tenants={tenants} />
    </AppShell>
  )
}

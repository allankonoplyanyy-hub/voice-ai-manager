import { AppShell } from "@/components/app-shell"
import { KnowledgeBrowser } from "@/components/voice/knowledge-browser"
import { requirePageAuth } from "@/lib/require-page-auth"
import { DEMO_KNOWLEDGE, getTenant } from "@/lib/voice/tenants"

export const metadata = { title: "База знаний — AAA Voice AI Manager" }

export const dynamic = "force-dynamic"

export default async function KnowledgePage() {
  const { companyId } = await requirePageAuth()
  // Документы фильтруются по компании: в базе знаний лежат цены, условия и
  // скрипты — это коммерческая информация конкретного клиента.
  const documents = DEMO_KNOWLEDGE.filter((d) => d.companyId === companyId)
  const own = getTenant(companyId)
  const tenants = own ? [{ companyId: own.companyId, name: own.name }] : []
  return (
    <AppShell>
      <KnowledgeBrowser documents={documents} tenants={tenants} />
    </AppShell>
  )
}

import { AppShell } from "@/components/app-shell"
import { CallsList } from "@/components/voice/calls-list"
import { ensureSeeded, listAllCalls } from "@/lib/voice/persist"
import { DEMO_TENANTS } from "@/lib/voice/tenants"

export const metadata = { title: "Звонки — AAA Voice AI Manager" }

// Список читается из базы: без этого новый звонок не появился бы до пересборки.
export const dynamic = "force-dynamic"

export default async function CallsPage() {
  await ensureSeeded()
  const calls = (await listAllCalls()).map((c) => ({
    callId: c.callId,
    companyId: c.companyId,
    clientName: c.clientName,
    clientPhone: c.clientPhone,
    startedAt: c.startedAt,
    durationSec: c.durationSec,
    state: c.state,
    outcome: c.outcome,
    intent: c.intent,
    hasLead: c.leadId !== null,
    hasBooking: c.bookingId !== null,
    hasHandoff: c.handoff !== null,
  }))
  const tenants = DEMO_TENANTS.map((t) => ({ companyId: t.companyId, name: t.name }))

  return (
    <AppShell>
      <CallsList calls={calls} tenants={tenants} />
    </AppShell>
  )
}

import { AppShell } from "@/components/app-shell"
import { CallsList } from "@/components/voice/calls-list"
import { getAllCalls } from "@/lib/voice/store"
import { DEMO_TENANTS } from "@/lib/voice/tenants"

export const metadata = { title: "Звонки — AAA Voice AI Manager" }

export default function CallsPage() {
  const calls = getAllCalls().map((c) => ({
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

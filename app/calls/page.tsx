import { AppShell } from "@/components/app-shell"
import { CallsList } from "@/components/voice/calls-list"
import { requirePageAuth } from "@/lib/require-page-auth"
import { ensureSeeded, listCallsByCompany } from "@/lib/voice/persist"
import { getTenant } from "@/lib/voice/tenants"

export const metadata = { title: "Звонки — AAA Voice AI Manager" }

// Список читается из базы: без этого новый звонок не появился бы до пересборки.
export const dynamic = "force-dynamic"

export default async function CallsPage() {
  const { companyId } = await requirePageAuth()
  await ensureSeeded()
  const calls = (await listCallsByCompany(companyId)).map((c) => ({
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
  // В фильтре остаётся только своя компания: перечень остальных клиентов
  // сервиса пользователю видеть незачем.
  const tenant = getTenant(companyId)
  const tenants = tenant ? [{ companyId: tenant.companyId, name: tenant.name }] : []

  return (
    <AppShell>
      <CallsList calls={calls} tenants={tenants} />
    </AppShell>
  )
}

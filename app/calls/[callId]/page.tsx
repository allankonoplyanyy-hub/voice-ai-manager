import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { CallDetail } from "@/components/voice/call-detail"
import { getBooking, getCall, getEventsByCall, getFollowUpsByCall, getLead } from "@/lib/voice/store"
import { getTenant } from "@/lib/voice/tenants"

export const metadata = { title: "Карточка звонка — AAA Voice AI Manager" }

export default async function CallPage({ params }: { params: Promise<{ callId: string }> }) {
  const { callId } = await params
  const call = getCall(callId)
  if (!call) notFound()

  const tenant = getTenant(call.companyId)
  const lead = call.leadId ? (getLead(call.leadId) ?? null) : null
  const booking = call.bookingId ? (getBooking(call.bookingId) ?? null) : null
  const followUps = getFollowUpsByCall(call.callId)
  const events = getEventsByCall(call.callId)

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <Link
          href="/calls"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> К списку звонков
        </Link>
        <CallDetail
          call={call}
          tenantName={tenant?.name ?? call.companyId}
          lead={lead}
          booking={booking}
          followUps={followUps}
          events={events}
        />
      </div>
    </AppShell>
  )
}

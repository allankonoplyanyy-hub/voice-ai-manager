import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { CallDetail } from "@/components/voice/call-detail"
import { requirePageAuth } from "@/lib/require-page-auth"
import { getCallDetail } from "@/lib/voice/persist"
import { getTenant } from "@/lib/voice/tenants"

export const metadata = { title: "Карточка звонка — AAA Voice AI Manager" }

export const dynamic = "force-dynamic"

export default async function CallPage({ params }: { params: Promise<{ callId: string }> }) {
  const { companyId } = await requirePageAuth()
  const { callId } = await params
  // Звонок чужой компании для текущего пользователя не существует: возвращается
  // та же «страница не найдена», что и для несуществующего звонка.
  const detail = await getCallDetail(callId, companyId)
  if (!detail) notFound()

  const { call, lead, booking, followUps, events } = detail
  const tenant = getTenant(call.companyId)

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

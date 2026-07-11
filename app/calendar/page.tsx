import { CalendarCheck } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { getAllBookings, getCall } from "@/lib/voice/store"
import { getTenant } from "@/lib/voice/tenants"

export const metadata = { title: "Календарь — AAA Voice AI Manager" }

export default function CalendarPage() {
  const bookings = getAllBookings()

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Календарь записей</h1>
          <p className="text-sm text-muted-foreground">
            Записи, созданные голосовым ассистентом. Синхронизация с внешним календарём — mock.
          </p>
        </header>

        <ul className="flex flex-col gap-2">
          {bookings.map((b) => {
            const tenant = getTenant(b.companyId)
            const call = getCall(b.callId)
            return (
              <li
                key={b.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card p-4"
              >
                <CalendarCheck className="size-5 shrink-0 text-gold" aria-hidden="true" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium">{b.service}</span>
                  <span className="text-xs text-muted-foreground">
                    {tenant?.name} · {call?.clientName ?? call?.clientPhone ?? "клиент"}
                  </span>
                </div>
                <span className="text-sm tabular-nums">
                  {new Date(b.date).toLocaleDateString("ru-RU", { day: "2-digit", month: "long" })}, {b.time}
                </span>
                <span
                  className={
                    b.status === "confirmed"
                      ? "rounded-md bg-success/10 px-2 py-0.5 text-xs font-medium text-success"
                      : "rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                  }
                >
                  {b.status === "confirmed" ? "Подтверждена" : b.status === "pending_manager" ? "Ожидает менеджера" : "Отменена"}
                </span>
                <span
                  className={
                    b.calendarStatus === "synced_mock"
                      ? "rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                      : "rounded-md bg-destructive/10 px-2 py-0.5 text-xs text-destructive"
                  }
                >
                  {b.calendarStatus === "synced_mock" ? "Календарь: mock" : "Календарь: retry"}
                </span>
              </li>
            )
          })}
          {bookings.length === 0 && (
            <li className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Пока нет записей. Запустите сценарий в Live Demo.
            </li>
          )}
        </ul>
      </div>
    </AppShell>
  )
}

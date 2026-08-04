import { CalendarCheck } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { callSummaries, ensureSeeded, listAllBookings } from "@/lib/voice/persist"
import { getTenant } from "@/lib/voice/tenants"

export const metadata = { title: "Календарь — AAA Voice AI Manager" }

// Записи читаются из базы, поэтому пререндер на сборке недопустим.
export const dynamic = "force-dynamic"

const MONTHS_RU = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
]

// Дата записи — календарный день, а не момент времени. new Date("2026-08-05")
// парсится как UTC-полночь, поэтому в западных таймзонах показала бы 4 августа.
// Разбираем строку напрямую, без часовых поясов.
function formatBookingDate(date: string): string {
  const [, month, day] = date.split("-")
  const monthName = MONTHS_RU[Number(month) - 1] ?? month
  return `${day} ${monthName}`
}

export default async function CalendarPage() {
  await ensureSeeded()
  const bookings = await listAllBookings()
  // Имена клиентов одним запросом вместо выборки на каждую запись.
  const clients = await callSummaries(bookings.map((b) => b.callId))

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
            const call = clients.get(b.callId)
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
                  {formatBookingDate(b.date)}, {b.time}
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

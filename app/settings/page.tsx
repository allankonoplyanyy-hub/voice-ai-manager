import { Database, Info, ShieldCheck, Webhook } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { isDatabaseConfigured } from "@/lib/db"
import { ensureSeeded, storeCounters } from "@/lib/voice/persist"

export const metadata = { title: "Настройки — AAA Voice AI Manager" }

export default async function SettingsPage() {
  await ensureSeeded()
  const counters = await storeCounters()
  const dbReady = isDatabaseConfigured()
  // Секреты только проверяются на наличие, значения не читаются и не выводятся.
  const controlCenterReady = Boolean(process.env.VOICE_CONTROL_CENTER_SECRET)
  const cronReady = Boolean(process.env.CRON_SECRET ?? process.env.VOICE_CRON_SECRET)

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Настройки</h1>
          <p className="text-sm text-muted-foreground">Состояние системы и готовность подсистем.</p>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Info className="size-4" aria-hidden="true" /> Режим работы
            </h2>
            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Режим</dt>
                <dd className="font-medium">Demo</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Телефония / STT / LLM / TTS</dt>
                <dd>Заглушки</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Режим live</dt>
                <dd className="text-muted-foreground">Заблокирован preflight</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Платные API</dt>
                <dd>Не используются</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              Медиа-тракт не подключён, поэтому preflight не допускает режим live. Это ограничение
              намеренное, а не сбой.
            </p>
          </section>

          <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Database className="size-4" aria-hidden="true" /> Данные (Postgres)
            </h2>
            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Звонки</dt>
                <dd className="tabular-nums">{counters.calls}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Лиды</dt>
                <dd className="tabular-nums">{counters.leads}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Записи</dt>
                <dd className="tabular-nums">{counters.bookings}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Follow-up</dt>
                <dd className="tabular-nums">{counters.followUps}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">События в outbox</dt>
                <dd className="tabular-nums">{counters.events}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Подключение к БД</dt>
                <dd className={dbReady ? "text-success" : "text-destructive"}>
                  {dbReady ? "Настроено" : "Не настроено"}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              Данные хранятся в Postgres и переживают перезапуск сервера.
            </p>
          </section>

          <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Webhook className="size-4" aria-hidden="true" /> Control Center
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Приём: <code className="rounded bg-muted px-1 py-0.5 text-xs">POST /api/voice/webhooks/provider</code>.
              Подпись HMAC-SHA256, защита от повторов по временному окну и уникальности события.
              Исходящие события идут через outbox с повторами и dead-letter.
            </p>
            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Секрет подписи</dt>
                <dd className={controlCenterReady ? "text-success" : "text-destructive"}>
                  {controlCenterReady ? "Задан" : "Не задан — маршрут отдаёт 503"}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Токен планировщика</dt>
                <dd className={cronReady ? "text-success" : "text-destructive"}>
                  {cronReady ? "Задан" : "Не задан — доставка не запускается"}
                </dd>
              </div>
            </dl>
            {(!controlCenterReady || !cronReady) && (
              <p className="text-xs text-muted-foreground">
                Без секретов маршруты намеренно отказывают вместо работы без защиты. Добавьте
                VOICE_CONTROL_CENTER_SECRET и CRON_SECRET в переменные проекта.
              </p>
            )}
          </section>

          <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="size-4" aria-hidden="true" /> Безопасность и изоляция
            </h2>
            <ul className="flex list-inside list-disc flex-col gap-1 text-sm text-muted-foreground">
              <li>Multi-tenant: каждый запрос к данным ограничен companyId</li>
              <li>Строгая state machine: запрещённые переходы отклоняются</li>
              <li>Двойная бронь исключена уникальным индексом в БД</li>
              <li>Идемпотентность записи и вебхуков хранится в БД, а не в памяти</li>
              <li>Согласие на обработку — обязательный этап диалога</li>
              <li>Мягкая деградация: сбой CRM или календаря не прерывает звонок</li>
            </ul>
          </section>
        </div>
      </div>
    </AppShell>
  )
}

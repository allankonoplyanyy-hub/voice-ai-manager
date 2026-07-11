import { Database, Info, ShieldCheck, Webhook } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { getStore } from "@/lib/voice/store"

export const metadata = { title: "Настройки — AAA Voice AI Manager" }

export default function SettingsPage() {
  const store = getStore()

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Настройки</h1>
          <p className="text-sm text-muted-foreground">Параметры demo-режима и состояние системы.</p>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Info className="size-4" aria-hidden="true" /> Режим работы
            </h2>
            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Режим</dt>
                <dd className="font-medium">Demo (mock-провайдеры)</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Телефония</dt>
                <dd>Не подключена</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Платные API</dt>
                <dd>Не используются</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Store инициализирован</dt>
                <dd className="tabular-nums">{new Date(store.seededAt).toLocaleString("ru-RU")}</dd>
              </div>
            </dl>
          </section>

          <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Database className="size-4" aria-hidden="true" /> Данные (in-memory)
            </h2>
            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Звонки</dt>
                <dd className="tabular-nums">{store.calls.size}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Лиды</dt>
                <dd className="tabular-nums">{store.leads.size}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Записи</dt>
                <dd className="tabular-nums">{store.bookings.size}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Follow-up</dt>
                <dd className="tabular-nums">{store.followUps.size}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">События</dt>
                <dd className="tabular-nums">{store.events.length}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              Данные пересоздаются при перезапуске сервера — по требованиям demo-режима.
            </p>
          </section>

          <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Webhook className="size-4" aria-hidden="true" /> Webhook и события
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Endpoint: <code className="rounded bg-muted px-1 py-0.5 text-xs">POST /api/voice/webhooks/provider</code>.
              Обработка идемпотентна: повторная доставка события с тем же ключом не создаёт дублей.
              Все события подписываются mock-HMAC подписью.
            </p>
            <p className="text-sm text-muted-foreground">
              Обработано ключей идемпотентности: <span className="tabular-nums">{store.processedWebhookKeys.size}</span>
            </p>
          </section>

          <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="size-4" aria-hidden="true" /> Безопасность и изоляция
            </h2>
            <ul className="flex list-inside list-disc flex-col gap-1 text-sm text-muted-foreground">
              <li>Multi-tenant: все объекты привязаны к companyId</li>
              <li>Выборки данных строго изолированы по компаниям</li>
              <li>Строгая state machine: запрещённые переходы отклоняются</li>
              <li>Лимиты длительности и стоимости на каждый звонок</li>
              <li>Согласие на обработку — обязательный этап диалога</li>
              <li>Мягкая деградация: сбой CRM/календаря не прерывает звонок</li>
            </ul>
          </section>
        </div>
      </div>
    </AppShell>
  )
}

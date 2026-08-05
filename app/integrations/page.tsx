import { AppShell } from "@/components/app-shell"
import { requirePageAuth } from "@/lib/require-page-auth"
import { ADAPTERS } from "@/lib/voice/adapters"
import type { RoutingKind } from "@/lib/voice/providers/telephony"
import { companyRoutingStatus, routingConfig } from "@/lib/voice/telephony-routing"

export const metadata = { title: "Интеграции — AAA Voice AI Manager" }

export const dynamic = "force-dynamic"

const KIND_LABELS: Record<RoutingKind, string> = {
  forwarded: "Свой номер с переадресацией на SIP",
  rented: "Арендованный номер провайдера",
}

export default async function IntegrationsPage() {
  const { companyId } = await requirePageAuth()

  // Показывается маршрутизация только своей компании. Список номеров остальных
  // арендаторов здесь был бы утечкой их контактов.
  const routing = companyRoutingStatus(companyId)
  const numberTakenTwice = routing ? routingConfig().index.collisions.includes(routing.publicNumber) : false

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Интеграции</h1>
          <p className="text-sm text-muted-foreground">
            Архитектура построена на единых интерфейсах адаптеров. Сейчас все провайдеры работают
            в mock-режиме; live-провайдеры описаны, но не активированы. Система никогда не падает
            из-за ненастроенного провайдера — возвращается статус «не настроен».
          </p>
        </header>

        {routing && (
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Маршрутизация номера</h2>
              <span
                className={
                  routing.ready
                    ? "rounded-md bg-gold/15 px-2 py-0.5 text-xs font-medium text-gold"
                    : "rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                }
              >
                {routing.ready ? "Готово к живым звонкам" : "Не настроено — demo"}
              </span>
            </div>

            <dl className="flex flex-col gap-1 text-xs">
              <div className="flex flex-wrap gap-2">
                <dt className="shrink-0 font-medium text-muted-foreground">Схема:</dt>
                <dd>{KIND_LABELS[routing.kind]}</dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="shrink-0 font-medium text-muted-foreground">Номер:</dt>
                <dd className="font-mono">{routing.publicNumber}</dd>
              </div>
            </dl>

            {routing.missing.length > 0 && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                Для приёма реальных звонков не хватает: {routing.missing.join(", ")}. До этого звонки
                остаются имитацией demo-сценариев.
              </p>
            )}

            {numberTakenTwice && (
              <p className="text-xs leading-relaxed text-destructive">
                Этот номер указан более чем у одной компании, поэтому звонки на него не принимаются:
                иначе разговор мог бы попасть в чужой кабинет. Обратитесь к администратору сервиса.
              </p>
            )}
          </section>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {ADAPTERS.map((a) => (
            <article key={a.id} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{a.kindLabel}</h2>
                <span className="rounded-md bg-gold/15 px-2 py-0.5 text-xs font-medium text-gold">
                  Mock-режим
                </span>
              </div>
              <p className="font-mono text-xs text-muted-foreground">{a.name}</p>
              <p className="text-sm leading-relaxed text-muted-foreground">{a.description}</p>
              <dl className="mt-1 flex flex-col gap-1 text-xs">
                <div className="flex gap-2">
                  <dt className="shrink-0 font-medium text-muted-foreground">Сейчас:</dt>
                  <dd>{a.mockProvider}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="shrink-0 font-medium text-muted-foreground">Live (не активировано):</dt>
                  <dd className="text-muted-foreground">{a.liveProviders.join(", ")}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </div>
    </AppShell>
  )
}

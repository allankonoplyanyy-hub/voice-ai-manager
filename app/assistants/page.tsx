import { Bot, Phone, ShieldAlert, Timer, Wallet } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { requirePageAuth } from "@/lib/require-page-auth"
import { getKnowledge, getTenant } from "@/lib/voice/tenants"

export const metadata = { title: "Ассистенты — AAA Voice AI Manager" }

export const dynamic = "force-dynamic"

export default async function AssistantsPage() {
  const { companyId } = await requirePageAuth()
  // Показывается только свой ассистент: системный промт, лимиты и номер —
  // коммерческие настройки, которые другим компаниям видеть нельзя.
  const own = getTenant(companyId)
  const tenants = own ? [own] : []

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Ассистент</h1>
          <p className="text-sm text-muted-foreground">
            Голосовой ассистент вашей компании: номер, приветствие, промт, лимиты и база знаний.
          </p>
        </header>

        <div className="grid gap-4 lg:grid-cols-2">
          {tenants.map((t) => {
            const docsCount = getKnowledge(t.companyId).length
            return (
              <article
                key={t.companyId}
                id={t.companyId}
                className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-accent">
                      <Bot className="size-5" aria-hidden="true" />
                    </span>
                    <div>
                      <h2 className="text-sm font-semibold">{t.name}</h2>
                      <p className="text-xs text-muted-foreground">{t.industry}</p>
                    </div>
                  </div>
                  <span className="rounded-md bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                    Активен
                  </span>
                </div>

                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Phone className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span>{t.phoneNumber}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Timer className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span>до {Math.round(t.maxCallDurationSec / 60)} мин</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Wallet className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span>лимит {t.maxCallCostTenge} ₸/звонок</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span>{docsCount} документов знаний</span>
                  </div>
                </dl>

                <div className="rounded-lg bg-muted p-3">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Приветствие</p>
                  <p className="text-sm leading-relaxed">{t.greeting}</p>
                </div>

                <div className="rounded-lg bg-muted p-3">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Системный промт</p>
                  <p className="text-sm leading-relaxed text-muted-foreground">{t.systemPrompt}</p>
                </div>

                {t.criticalKeywords.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                      Критические слова (мгновенная передача менеджеру):
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {t.criticalKeywords.map((kw) => (
                        <span
                          key={kw}
                          className="rounded-md bg-destructive/10 px-2 py-0.5 text-xs text-destructive"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </div>
    </AppShell>
  )
}

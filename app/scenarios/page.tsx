import Link from "next/link"
import { PlayCircle } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { DEMO_SCENARIOS } from "@/lib/voice/scenarios"
import { DEMO_TENANTS } from "@/lib/voice/tenants"
import { OUTCOME_LABELS } from "@/components/voice/badges"

export const metadata = { title: "Сценарии — AAA Voice AI Manager" }

export default function ScenariosPage() {
  const tenantName = new Map(DEMO_TENANTS.map((t) => [t.companyId, t.name]))
  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Demo-сценарии</h1>
          <p className="text-sm text-muted-foreground">
            Подготовленные сценарии звонков: успешные, сложные и сбойные ситуации.
            Любой сценарий можно проиграть на странице Live Demo.
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          {DEMO_SCENARIOS.map((s) => (
            <article key={s.id} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-sm font-semibold">{s.title}</h2>
                <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {OUTCOME_LABELS[s.expectedOutcome]}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{tenantName.get(s.companyId)}</p>
              <p className="text-sm leading-relaxed text-muted-foreground">{s.context}</p>
              <ul className="flex flex-wrap gap-1.5 text-xs">
                {s.createsLead && <li className="rounded-md bg-success/10 px-2 py-0.5 text-success">Лид</li>}
                {s.createsBooking && <li className="rounded-md bg-success/10 px-2 py-0.5 text-success">Запись</li>}
                {s.createsHandoff && <li className="rounded-md bg-accent px-2 py-0.5 text-accent-foreground">Handoff</li>}
                {s.followUps.length > 0 && (
                  <li className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">
                    Follow-up ×{s.followUps.length}
                  </li>
                )}
                <li className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">{s.steps.length} шагов</li>
              </ul>
              <Link
                href="/demo"
                className="mt-1 flex w-fit items-center gap-1 text-sm font-medium underline underline-offset-4"
              >
                <PlayCircle className="size-4" aria-hidden="true" /> Проиграть в Live Demo
              </Link>
            </article>
          ))}
        </div>
      </div>
    </AppShell>
  )
}

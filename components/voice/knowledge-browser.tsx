"use client"

import { useMemo, useState } from "react"
import { BookOpen, ShieldAlert } from "lucide-react"
import type { KnowledgeDocument } from "@/lib/voice/types"
import { cn } from "@/lib/utils"

const CATEGORY_LABELS: Record<KnowledgeDocument["category"], string> = {
  about: "О компании",
  services: "Услуги",
  pricing: "Цены",
  schedule: "График",
  address: "Адрес",
  staff: "Сотрудники",
  faq: "FAQ",
  rules: "Правила",
  objections: "Возражения",
  forbidden: "Запрещённые ответы",
  handoff_rules: "Передача менеджеру",
}

export function KnowledgeBrowser({
  documents,
  tenants,
}: {
  documents: KnowledgeDocument[]
  tenants: { companyId: string; name: string }[]
}) {
  const [companyId, setCompanyId] = useState(tenants[0]?.companyId ?? "")

  const docs = useMemo(
    // Изоляция: только документы выбранной компании
    () => documents.filter((d) => d.companyId === companyId),
    [documents, companyId],
  )

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">База знаний</h1>
        <p className="text-sm text-muted-foreground">
          Company-scoped знания ассистента. Ассистент отвечает только на основе этих документов
          и не придумывает цены, услуги или свободные слоты.
        </p>
      </header>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Компании">
        {tenants.map((t) => (
          <button
            key={t.companyId}
            type="button"
            role="tab"
            aria-selected={companyId === t.companyId}
            onClick={() => setCompanyId(t.companyId)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm transition-colors",
              companyId === t.companyId
                ? "border-gold bg-accent font-medium"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {t.name}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {docs.map((d) => (
          <article key={d.id} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              {d.category === "forbidden" || d.category === "handoff_rules" ? (
                <ShieldAlert className="size-4 text-destructive" aria-hidden="true" />
              ) : (
                <BookOpen className="size-4 text-muted-foreground" aria-hidden="true" />
              )}
              <h2 className="text-sm font-semibold">{d.title}</h2>
              <span className="ml-auto rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {CATEGORY_LABELS[d.category]}
              </span>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">{d.content}</p>
          </article>
        ))}
        {docs.length === 0 && (
          <p className="text-sm text-muted-foreground">У этой компании пока нет документов.</p>
        )}
      </div>
    </div>
  )
}

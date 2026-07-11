"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { Bot, CheckCircle2, ExternalLink, Loader2, Play, RotateCcw, User } from "lucide-react"
import { HAPPY_PATH, STATE_LABELS } from "@/lib/voice/state-machine"
import type { CallState, DemoScenario } from "@/lib/voice/types"
import { cn } from "@/lib/utils"

interface RunResult {
  callId: string
  outcome: string
  leadId: string | null
  bookingId: string | null
  handoff: boolean
  followUps: number
  events: number
}

type PlayedStep = { role: "client" | "assistant" | "system"; text: string; state: CallState }

export function LiveDemo({
  scenarios,
  tenants,
}: {
  scenarios: DemoScenario[]
  tenants: { companyId: string; name: string }[]
}) {
  const tenantName = new Map(tenants.map((t) => [t.companyId, t.name]))
  const [selectedId, setSelectedId] = useState(scenarios[0]?.id ?? "")
  const [playing, setPlaying] = useState(false)
  const [steps, setSteps] = useState<PlayedStep[]>([])
  const [currentState, setCurrentState] = useState<CallState>("received")
  const [result, setResult] = useState<RunResult | null>(null)
  const [saving, setSaving] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const scenario = scenarios.find((s) => s.id === selectedId)

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setPlaying(false)
    setSteps([])
    setCurrentState("received")
    setResult(null)
    setSaving(false)
  }, [])

  useEffect(() => reset(), [selectedId, reset])
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }, [steps])

  const play = useCallback(() => {
    if (!scenario || playing) return
    reset()
    setPlaying(true)
    let i = 0
    let state: CallState = "received"

    const next = () => {
      if (!scenario.steps[i]) {
        setPlaying(false)
        setSaving(true)
        // Сохраняем прогон через API — появится в списке звонков
        fetch("/api/voice/demo/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenarioId: scenario.id }),
        })
          .then((r) => r.json())
          .then((data: RunResult) => setResult(data))
          .catch(() => setResult(null))
          .finally(() => setSaving(false))
        return
      }
      const step = scenario.steps[i]
      if (step.toState) state = step.toState
      setCurrentState(state)
      setSteps((prev) => [...prev, { role: step.role, text: step.text, state }])
      i += 1
      timerRef.current = setTimeout(next, step.delayMs ?? 900)
    }
    next()
  }, [scenario, playing, reset])

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Live Demo</h1>
        <p className="text-sm text-muted-foreground">
          Пошаговая имитация звонка: выберите сценарий и наблюдайте за диалогом и переходами state machine.
          Телефония не подключена — это управляемая demo-имитация.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Список сценариев */}
        <section aria-label="Сценарии" className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Сценарии ({scenarios.length})</h2>
          <ul className="flex flex-col gap-2">
            {scenarios.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  aria-pressed={selectedId === s.id}
                  className={cn(
                    "w-full rounded-xl border p-3 text-left transition-colors",
                    selectedId === s.id
                      ? "border-gold bg-accent"
                      : "border-border bg-card hover:border-gold/40",
                  )}
                >
                  <span className="block text-sm font-medium">{s.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {tenantName.get(s.companyId)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* Плеер */}
        <section aria-label="Диалог" className="flex flex-col gap-3 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={play}
              disabled={playing || !scenario}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {playing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
              {playing ? "Звонок идёт…" : "Запустить звонок"}
            </button>
            <button
              type="button"
              onClick={reset}
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm"
            >
              <RotateCcw className="size-4" aria-hidden="true" /> Сброс
            </button>
          </div>

          {/* Прогресс состояний */}
          <div className="flex flex-wrap gap-1.5" aria-label="Состояния звонка">
            {HAPPY_PATH.map((st) => {
              const idx = HAPPY_PATH.indexOf(currentState)
              const stIdx = HAPPY_PATH.indexOf(st)
              const passed = idx >= 0 && stIdx <= idx
              const isAlt = HAPPY_PATH.indexOf(currentState) === -1
              return (
                <span
                  key={st}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-xs",
                    passed && !isAlt
                      ? "bg-gold text-gold-foreground font-medium"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {STATE_LABELS[st]}
                </span>
              )
            })}
            {HAPPY_PATH.indexOf(currentState) === -1 && steps.length > 0 && (
              <span className="rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                {STATE_LABELS[currentState]}
              </span>
            )}
          </div>

          {/* Диалог */}
          <div
            className="flex h-96 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-card p-4"
            role="log"
            aria-live="polite"
            aria-label="Транскрипт демонстрационного звонка"
          >
            {steps.length === 0 && (
              <p className="m-auto text-sm text-muted-foreground">
                {scenario ? `«${scenario.title}» — нажмите «Запустить звонок»` : "Выберите сценарий"}
              </p>
            )}
            {steps.map((step, i) =>
              step.role === "system" ? (
                <p key={i} className="self-center rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                  {step.text}
                </p>
              ) : (
                <div
                  key={i}
                  className={cn(
                    "max-w-[85%] rounded-xl px-3 py-2",
                    step.role === "assistant"
                      ? "self-start rounded-tl-sm bg-muted"
                      : "self-end rounded-tr-sm bg-accent",
                  )}
                >
                  <p className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    {step.role === "assistant" ? (
                      <>
                        <Bot className="size-3" aria-hidden="true" /> Ассистент
                      </>
                    ) : (
                      <>
                        <User className="size-3" aria-hidden="true" /> Клиент
                      </>
                    )}
                  </p>
                  <p className="text-sm leading-relaxed">{step.text}</p>
                </div>
              ),
            )}
            <div ref={bottomRef} />
          </div>

          {/* Итог */}
          {saving && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Сохраняю результаты звонка…
            </p>
          )}
          {result && (
            <div className="flex flex-col gap-2 rounded-xl border border-gold/40 bg-accent p-4">
              <p className="flex items-center gap-2 text-sm font-medium">
                <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                Звонок обработан и сохранён
              </p>
              <ul className="text-sm text-muted-foreground">
                {result.leadId && <li>Создан лид (отправлен в CRM, mock)</li>}
                {result.bookingId && <li>Создана запись в календаре (mock)</li>}
                {result.handoff && <li>Выполнена передача менеджеру с резюме</li>}
                {result.followUps > 0 && <li>Отправлено follow-up сообщений: {result.followUps}</li>}
                <li>Событий webhook: {result.events}</li>
              </ul>
              <Link
                href={`/calls/${result.callId}`}
                className="flex w-fit items-center gap-1 text-sm font-medium text-foreground underline underline-offset-4"
              >
                Открыть карточку звонка <ExternalLink className="size-3" aria-hidden="true" />
              </Link>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

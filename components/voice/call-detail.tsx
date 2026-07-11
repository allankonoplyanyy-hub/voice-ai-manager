import {
  AlertTriangle,
  Bot,
  CalendarCheck,
  MessageSquare,
  Phone,
  User,
  Webhook,
} from "lucide-react"
import { STATE_LABELS } from "@/lib/voice/state-machine"
import type { Booking, FollowUp, Lead, VoiceCall, VoiceEvent } from "@/lib/voice/types"
import { OutcomeBadge, StateBadge, formatDateTime, formatDuration } from "@/components/voice/badges"

const HANDOFF_REASON_LABELS: Record<string, string> = {
  customer_request: "Запрос клиента",
  aggression: "Агрессия / конфликт",
  out_of_knowledge: "Вне базы знаний",
  vip_client: "VIP-клиент",
  complaint: "Жалоба",
  high_value_deal: "Крупная сделка",
  recognition_failure: "Сбой распознавания",
  critical_keyword: "Критическое слово",
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  )
}

export function CallDetail({
  call,
  tenantName,
  lead,
  booking,
  followUps,
  events,
}: {
  call: VoiceCall
  tenantName: string
  lead: Lead | null
  booking: Booking | null
  followUps: FollowUp[]
  events: VoiceEvent[]
}) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {call.clientName ?? "Неизвестный клиент"}
          </h1>
          <StateBadge state={call.state} />
          <OutcomeBadge outcome={call.outcome} />
        </div>
        <p className="text-sm text-muted-foreground">
          {tenantName} · {call.clientPhone} · {formatDateTime(call.startedAt)} ·{" "}
          {formatDuration(call.durationSec)} · {call.costTenge} ₸
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {/* Транскрипт */}
          <Section title="Транскрипт разговора">
            <ol className="flex flex-col gap-3">
              {call.transcript.map((entry, i) => (
                <li
                  key={i}
                  className={
                    entry.role === "system"
                      ? "self-center"
                      : entry.role === "assistant"
                        ? "self-start max-w-[85%]"
                        : "self-end max-w-[85%]"
                  }
                >
                  {entry.role === "system" ? (
                    <p className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                      {entry.text}
                    </p>
                  ) : (
                    <div
                      className={
                        entry.role === "assistant"
                          ? "rounded-xl rounded-tl-sm bg-muted px-3 py-2"
                          : "rounded-xl rounded-tr-sm bg-accent px-3 py-2"
                      }
                    >
                      <p className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                        {entry.role === "assistant" ? (
                          <>
                            <Bot className="size-3" aria-hidden="true" /> Ассистент
                          </>
                        ) : (
                          <>
                            <User className="size-3" aria-hidden="true" /> Клиент
                          </>
                        )}
                        <span className="font-normal">· {STATE_LABELS[entry.state]}</span>
                      </p>
                      <p className="text-sm leading-relaxed">{entry.text}</p>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </Section>

          {/* Резюме */}
          <Section title="Резюме для менеджера">
            <p className="text-sm leading-relaxed">{call.summary}</p>
            {call.unansweredQuestions.length > 0 && (
              <div className="rounded-lg bg-muted p-3">
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Вопросы без ответа (для пополнения базы знаний):
                </p>
                <ul className="list-inside list-disc text-sm">
                  {call.unansweredQuestions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            )}
          </Section>

          {/* События */}
          <Section title={`События (${events.length})`}>
            <ol className="flex flex-col gap-2">
              {events.map((e) => (
                <li key={e.eventId} className="flex items-start gap-2 text-sm">
                  <Webhook className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs">{e.type}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(e.timestamp)} · idempotency: {e.idempotencyKey.slice(0, 24)}…
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <div className="flex flex-col gap-6">
          {/* Хронология состояний */}
          <Section title="Хронология состояний">
            <ol className="flex flex-col">
              {call.transitions.map((t, i) => (
                <li key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-gold" aria-hidden="true" />
                    {i < call.transitions.length - 1 && (
                      <span className="w-px flex-1 bg-border" aria-hidden="true" />
                    )}
                  </div>
                  <div className="flex flex-col pb-3">
                    <span className="text-sm font-medium">{STATE_LABELS[t.to]}</span>
                    {t.note && <span className="text-xs text-muted-foreground">{t.note}</span>}
                  </div>
                </li>
              ))}
            </ol>
          </Section>

          {/* Лид */}
          {lead && (
            <Section title="Лид">
              <dl className="flex flex-col gap-2">
                <Field label="Имя" value={lead.name} />
                <Field label="Телефон" value={lead.phone} />
                <Field label="Интерес" value={lead.interest} />
                <Field
                  label="Оценка"
                  value={`${lead.score}/100 · ${lead.temperature === "hot" ? "Горячий" : lead.temperature === "warm" ? "Тёплый" : "Холодный"}`}
                />
                <Field label="Следующий шаг" value={lead.nextBestAction} />
                <Field
                  label="CRM"
                  value={
                    lead.crmStatus === "synced_mock"
                      ? "Синхронизирован (mock)"
                      : lead.crmStatus === "pending_retry"
                        ? "Ожидает повтора — CRM недоступна"
                        : "Ошибка (мягкая деградация)"
                  }
                />
              </dl>
            </Section>
          )}

          {/* Запись */}
          {booking && (
            <Section title="Запись">
              <dl className="flex flex-col gap-2">
                <Field label="Услуга" value={booking.service} />
                <Field label="Дата и время" value={`${booking.date}, ${booking.time}`} />
                <Field
                  label="Статус"
                  value={
                    booking.status === "confirmed"
                      ? "Подтверждена"
                      : booking.status === "pending_manager"
                        ? "Ожидает менеджера"
                        : "Отменена"
                  }
                />
                <Field
                  label="Календарь"
                  value={
                    booking.calendarStatus === "synced_mock"
                      ? "Синхронизирован (mock)"
                      : "Ожидает повтора — календарь недоступен"
                  }
                />
              </dl>
            </Section>
          )}

          {/* Передача менеджеру */}
          {call.handoff && (
            <Section title="Передача менеджеру">
              <dl className="flex flex-col gap-2">
                <Field
                  label="Причина"
                  value={HANDOFF_REASON_LABELS[call.handoff.reason] ?? call.handoff.reason}
                />
                <Field label="Детали" value={call.handoff.reasonText} />
                <Field label="Менеджер" value={call.handoff.targetManager} />
              </dl>
            </Section>
          )}

          {/* Follow-up */}
          {followUps.length > 0 && (
            <Section title="Follow-up сообщения">
              <ul className="flex flex-col gap-3">
                {followUps.map((f) => (
                  <li key={f.id} className="flex flex-col gap-1 rounded-lg bg-muted p-3">
                    <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                      <MessageSquare className="size-3" aria-hidden="true" />
                      {f.channel.toUpperCase()} →{" "}
                      {f.status === "sent_mock" ? "Отправлено (mock)" : f.status === "queued" ? "В очереди" : "Ошибка"}
                    </p>
                    <p className="text-sm leading-relaxed">{f.text}</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Ошибки */}
          {call.errors.length > 0 && (
            <Section title="Сбои и восстановление">
              <ul className="flex flex-col gap-2">
                {call.errors.map((err, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
                    <div>
                      <p>
                        <span className="font-mono text-xs uppercase text-muted-foreground">{err.system}</span>{" "}
                        {err.message}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {err.recovered ? "Обработано: звонок продолжен, задача в очереди повторов" : "Не восстановлено"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {!lead && !booking && !call.handoff && followUps.length === 0 && call.errors.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              <Phone className="mx-auto mb-2 size-5" aria-hidden="true" />
              Звонок без созданных объектов
            </div>
          )}

          {booking === null && call.bookingId === null && lead === null && call.leadId === null ? null : (
            <p className="text-xs text-muted-foreground">
              <CalendarCheck className="mr-1 inline size-3" aria-hidden="true" />
              Все интеграции работают в mock-режиме: реальные CRM и календарь не подключены.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

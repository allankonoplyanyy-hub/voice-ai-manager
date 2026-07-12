# Voice AI Manager

Демонстрационный симулятор голосового AI-администратора для малого бизнеса (школы, клиники, салоны, автосервисы, недвижимость, рестораны, e-commerce).

> **Важно: это demo/pilot scaffold, а не настоящая телефония.**
> Все звонки — детерминированные имитации сценариев. Внешние API (телефония, STT, TTS, LLM, CRM, календарь, мессенджеры) **не подключены** и в demo-режиме не вызываются — ни одного сетевого запроса. Данные хранятся in-memory и пересоздаются при перезапуске.

## Быстрый старт

```bash
pnpm install
pnpm dev        # http://localhost:3000
```

Проверки качества:

```bash
pnpm lint       # ESLint
pnpm typecheck  # tsc --noEmit
pnpm test       # Vitest (34 теста)
pnpm build      # next build
```

Переменные окружения не нужны для demo — см. `.env.example` (все переменные зарезервированы под live-режим).

## Архитектура

```
lib/voice/
  types.ts          Доменные типы (все объекты company-scoped: companyId)
  state-machine.ts  Строгая state machine звонка (терминальные состояния неизменяемы)
  scenarios.ts      14 детерминированных demo-сценариев
  engine.ts         Движок прогона сценария: транскрипт, лид, запись, события, cost guard
  store.ts          In-memory store + tenant-scoped выборки + идемпотентность
  tenants.ts        6 demo-компаний + база знаний
  providers.ts      Интерфейсы 9 провайдеров + mock-реализации + soft-fail
  adapters.ts       Описания адаптеров для UI (Mock / Not connected)
  security.ts       HMAC-SHA256, timestamp window, replay protection
  contract.ts       Подписанный API-контракт voice-ai.v1 (Control Center / CRM)
  cost-guard.ts     Лимиты стоимости и длительности звонка per-tenant
  retention.ts      Политика хранения транскриптов
  analytics.ts      Метрики, рассчитанные из реальных demo-звонков

app/api/voice/      REST API (tenants, calls, webhooks, metrics, handoff, follow-up)
app/                Admin UI на русском (Обзор, Звонки, Live Demo, Аналитика и др.)
tests/              Vitest: engine, security, store, providers
```

### State machine

`received → greeting → consent → identifying_intent → consulting/qualifying → lead_capture → booking → follow_up → completed`

Альтернативные терминальные состояния: `manager_handoff`, `no_answer`, `abandoned`, `rejected`, `provider_failed`, `cost_limit_reached`. Любой переход вне разрешённой карты отклоняется (`InvalidTransitionError`), терминальный звонок неизменяем.

### Multi-tenant isolation

Каждый объект (звонок, лид, запись, follow-up, документ базы знаний) содержит `companyId`. Все выборки — company-scoped; кросс-тенантная изоляция покрыта тестами.

### Provider adapters

9 интерфейсов: telephony, STT, TTS, LLM, knowledge, CRM, calendar, messaging, manager handoff. Demo использует только mock-реализации (0 сетевых запросов). Ненастроенный live-провайдер возвращает `not_configured` и не роняет систему.

### Безопасность webhook (контракт voice-ai.v1)

- **HMAC-SHA256**: `signature = HMAC(secret, "{timestamp}.{rawBody}")`, заголовки `x-voice-timestamp` / `x-voice-signature`;
- **Replay protection**: timestamp вне окна ±5 минут → 401;
- **Идемпотентность**: повторный `idempotencyKey` → `duplicate_ignored`, дубль не создаётся;
- **Терминальный звонок**: события по завершённому звонку игнорируются (`already_terminal`).

Исходящие события в Control Center / CRM упаковываются в подписанный конверт (`lib/voice/contract.ts`): версия, источник, timestamp, idempotencyKey, HMAC-подпись тела.

### Отказоустойчивость (soft-fail)

- **CRM недоступна** → лид сохраняется локально (`pending_retry`), задача в outbox, клиент не замечает сбой;
- **Календарь недоступен** → вместо записи создаётся заявка с желаемой датой + follow-up «администратор подтвердит»;
- **Менеджер недоступен** → заявка на обратный звонок + follow-up, клиент не теряется;
- **Cost guard** → превышение лимита стоимости/длительности завершает звонок `cost_limit_reached`;
- **Consent** → отдельное состояние диалога; отказ → терминальное `rejected`;
- **Retention** → транскрипты старше N дней очищаются, метаданные и аналитика сохраняются.

## Demo-сценарии (14)

Happy path: школа, клиника, салон, автосервис, недвижимость, ресторан, статус заказа.
Edge cases: агрессивный клиент → handoff, вопрос вне базы знаний, «дайте человека», нет слотов, **сбой CRM**, **сбой календаря**, **менеджер недоступен**.

Запуск: страница **Live Demo** в UI или `POST /api/voice/demo/run { "scenarioId": "school-enroll" }`.

## Подключение к Control Center (когда будет live)

1. Задать общий секрет `VOICE_WEBHOOK_SECRET` с обеих сторон;
2. Control Center принимает `SignedEnvelope<ControlCenterEventBody>` (см. `lib/voice/contract.ts`): проверка HMAC → окно timestamp → идемпотентность по `idempotencyKey`;
3. CRM принимает `SignedEnvelope<CrmLeadBody>` по тому же контракту;
4. Заменить mock-провайдеры в `createDemoRegistry()` на live-реализации интерфейсов из `lib/voice/providers.ts`.

## Live blockers (что нужно до продакшена)

- Реальная телефония (Twilio/Telnyx) + номер;
- STT/TTS/LLM провайдеры и их бюджеты;
- Персистентное хранилище (PostgreSQL) вместо in-memory;
- Реальный outbox с воркером retry для CRM/календаря;
- Аутентификация и авторизация Admin UI;
- Юридика: запись разговоров и хранение ПДн по законодательству РК.

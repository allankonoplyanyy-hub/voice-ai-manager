// Health и readiness.
//
// Разделение осознанное:
//  - liveness (?probe=live) отвечает без обращения к зависимостям: процесс жив;
//  - readiness (по умолчанию) проверяет БД и настройку секретов и возвращает 503,
//    если трафик принимать нельзя. Оркестратор должен уметь снять инстанс с
//    балансировки, не убивая его.
//
// Ответ не раскрывает строки подключения и значения секретов — только факт наличия.

import { NextResponse } from "next/server"
import { sql } from "drizzle-orm"
import { getAuthContext } from "@/lib/auth-context"
import { db } from "@/lib/db"
import { currentPreflight } from "@/lib/voice/runtime"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface DependencyStatus {
  name: string
  ok: boolean
  detail: string
  latencyMs?: number
}

async function checkDatabase(): Promise<DependencyStatus> {
  const started = Date.now()
  if (!process.env.DATABASE_URL) {
    return { name: "database", ok: false, detail: "DATABASE_URL не задан" }
  }
  try {
    await db.execute(sql`select 1`)
    return { name: "database", ok: true, detail: "доступна", latencyMs: Date.now() - started }
  } catch (error) {
    // Текст ошибки драйвера может содержать хост и пользователя — наружу не отдаём.
    console.log("[voice] health: сбой проверки БД:", error instanceof Error ? error.message : String(error))
    return { name: "database", ok: false, detail: "недоступна", latencyMs: Date.now() - started }
  }
}

function checkSecrets(): DependencyStatus {
  const inbound = Boolean(process.env.VOICE_PROVIDER_WEBHOOK_SECRET)
  const outbound = Boolean(process.env.VOICE_CONTROL_CENTER_SECRET)
  if (inbound && outbound) {
    return { name: "webhook_secrets", ok: true, detail: "входящий и исходящий секреты настроены" }
  }
  const missing = [!inbound && "VOICE_PROVIDER_WEBHOOK_SECRET", !outbound && "VOICE_CONTROL_CENTER_SECRET"]
    .filter(Boolean)
    .join(", ")
  // Отсутствие секретов не ломает readiness: система обязана работать в demo,
  // но live-режим будет заблокирован preflight-проверкой.
  return { name: "webhook_secrets", ok: true, detail: `не настроено: ${missing} (live-режим заблокирован)` }
}

export async function GET(request: Request) {
  const probe = new URL(request.url).searchParams.get("probe")

  if (probe === "live") {
    return NextResponse.json({ status: "alive", at: new Date().toISOString() })
  }

  const checks = [await checkDatabase(), checkSecrets()]
  const ready = checks.every((c) => c.ok)
  const preflight = currentPreflight()

  // Код ответа остаётся публичным: балансировщик не умеет входить в аккаунт,
  // а 503 нужен ему, чтобы снять инстанс с трафика.
  const status = ready ? 200 : 503
  const headers = { "Cache-Control": "no-store" }

  // Подробности — только для своих. Анонимный ответ перечислял, какие секреты
  // не настроены, то есть прямо подсказывал, какая защита сейчас отключена.
  const ctx = await getAuthContext()
  if (!ctx) {
    return NextResponse.json(
      { status: ready ? "ready" : "not_ready", at: new Date().toISOString() },
      { status, headers },
    )
  }

  return NextResponse.json(
    {
      status: ready ? "ready" : "not_ready",
      at: new Date().toISOString(),
      // Режим выводится из фактического окружения, а не из константы: запрос
      // live без настроенных провайдеров понижается до demo.
      mode: {
        requested: preflight.requestedMode,
        effective: preflight.effectiveMode,
        ready: preflight.ready,
        blockingReasons: preflight.blockingReasons,
      },
      checks,
    },
    { status, headers },
  )
}

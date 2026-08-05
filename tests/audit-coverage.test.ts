import { readFile, readdir } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * Каждая операция, меняющая данные компании, должна оставлять след в журнале.
 * Иначе на вопрос «кто удалил заявку» ответа не будет, а именно этот вопрос
 * возникает при разборе спорной ситуации.
 *
 * Тест сторожит границу: новый мутирующий маршрут без аудита сразу подсветится,
 * вместо того чтобы обнаружиться через месяцы при первом же разборе.
 */

const MUTATING = /export async function (POST|PATCH|PUT|DELETE)/

/**
 * Маршруты без пользовательского контекста: журнал компании к ним не применим.
 * Каждое исключение названо явно, чтобы список нельзя было тихо расширить.
 */
const EXEMPT = new Map([
  ["app/api/auth/[...all]/route.ts", "мост Better Auth: собственный учёт попыток входа"],
  ["app/api/voice/webhooks/provider/route.ts", "вебхук провайдера: аудит пишется внутри обработчика"],
  ["app/api/voice/outbox/deliver/route.ts", "воркер доставки по токену cron, без пользователя"],
])

async function collectRoutes(dir: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...(await collectRoutes(full)))
    } else if (entry.name === "route.ts") {
      found.push(full)
    }
  }
  return found
}

describe("аудит мутирующих маршрутов", () => {
  it("каждый мутирующий маршрут пишет в журнал", async () => {
    const routes = await collectRoutes("app/api")
    const missing: string[] = []

    for (const route of routes) {
      const source = await readFile(route, "utf8")
      if (!MUTATING.test(source)) continue
      if (EXEMPT.has(route)) continue
      // Ищется именно вызов, а не любое упоминание: оставшийся импорт
      // writeAudit создавал бы видимость покрытия при удалённом вызове.
      if (!/\bwriteAudit\s*\(/.test(source)) missing.push(route)
    }

    expect(missing, `мутации без аудита: ${missing.join(", ")}`).toEqual([])
  })

  it("аудит фиксирует и отказы, а не только успехи", async () => {
    // Отказ по правам — самое интересное для разбора событие: попытка выйти за
    // пределы своей роли. Если журнал пишет только успехи, она не видна.
    const source = await readFile("app/api/voice/tenants/[companyId]/route.ts", "utf8")
    expect(source).toContain('outcome: "denied"')
    expect(source).toContain('outcome: "ok"')
  })

  it("в журнал не попадает текст сообщений клиенту", async () => {
    // Тексты могут содержать личные данные, а журнал живёт дольше переписки.
    const source = await readFile("app/api/voice/calls/[callId]/follow-up/route.ts", "utf8")
    const auditCall = source.slice(source.indexOf("writeAudit"))
    expect(auditCall).not.toMatch(/detail:\s*\{[^}]*\bmessage\b/)
    expect(auditCall).not.toMatch(/detail:\s*\{[^}]*\bbody\b/)
  })

  it("список исключений не пуст и каждое объяснено", async () => {
    for (const [route, reason] of EXEMPT) {
      expect(reason.length, `исключение ${route} без объяснения`).toBeGreaterThan(10)
    }
  })
})

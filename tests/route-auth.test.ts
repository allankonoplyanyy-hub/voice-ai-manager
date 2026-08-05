// Проверка, что каждый маршрут и каждая страница закрыты проверкой доступа.
//
// Тест появился после реальной утечки: маршрут
// /api/voice/companies/[companyId]/calls брал companyId прямо из адреса и
// отдавал звонки с телефонами клиентов без всякой сессии. Хелпер проверки
// доступа в проекте был, но к этому маршруту его просто забыли подключить —
// а такую забывчивость обзор кода не ловит.
//
// Проверяется наличие защиты в файле, а не поведение HTTP: цель — заметить
// новый незакрытый маршрут в момент появления, без поднятого сервера.

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const APP_DIR = join(process.cwd(), "app")

function collect(dir: string, fileNames: string[]): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      found.push(...collect(full, fileNames))
    } else if (fileNames.includes(entry)) {
      found.push(full)
    }
  }
  return found
}

const relative = (path: string) => path.slice(process.cwd().length + 1)

/**
 * Маршруты, у которых сессии быть не может по своей природе. Каждый обязан
 * иметь собственный механизм защиты — он указан рядом и тоже проверяется.
 */
const PUBLIC_ROUTES: Record<string, RegExp> = {
  // Сам механизм входа: до входа сессии нет.
  "app/api/auth/[...all]/route.ts": /toNextJsHandler|auth\.handler/,
  // Вызывает провайдер телефонии, а не браузер: защита — подпись HMAC.
  "app/api/voice/webhooks/provider/route.ts": /verifyWebhook/,
  // Вызывает планировщик: защита — CRON_SECRET.
  "app/api/voice/outbox/deliver/route.ts": /CRON_SECRET/,
  // Проба балансировщика: он не умеет входить в аккаунт. Публичен только код
  // ответа, подробности отдаются лишь при наличии сессии.
  "app/api/voice/health/route.ts": /getAuthContext/,
}

const SESSION_GUARDS =
  /requireAuth|requirePageAuth|requireCompanyAccess|getAuthContext|authenticateRequest|authenticateCompanyRequest|auth\.api\.getSession/

describe("защита маршрутов API", () => {
  const routes = collect(APP_DIR, ["route.ts"]).map(relative)

  it("находит маршруты для проверки", () => {
    expect(routes.length).toBeGreaterThan(5)
  })

  it("каждый маршрут проверяет сессию либо имеет свой механизм защиты", () => {
    const unprotected = routes.filter((path) => {
      const source = readFileSync(join(process.cwd(), path), "utf8")
      const ownGuard = PUBLIC_ROUTES[path]
      return ownGuard ? !ownGuard.test(source) : !SESSION_GUARDS.test(source)
    })

    expect(unprotected).toEqual([])
  })

  it("маршруты с companyId в адресе сверяют его с сессией", () => {
    // Наличие проверки сессии тут недостаточно: важно, что значение из адреса
    // сверяется с компанией пользователя, иначе чужие данные снова утекут.
    const withCompanyInPath = routes.filter((path) => path.includes("[companyId]"))
    expect(withCompanyInPath.length).toBeGreaterThan(0)

    const notVerified = withCompanyInPath.filter((path) => {
      const source = readFileSync(join(process.cwd(), path), "utf8")
      return !/authenticateCompanyRequest|requireCompanyAccess/.test(source)
    })

    expect(notVerified).toEqual([])
  })
})

describe("защита страниц", () => {
  const pages = collect(APP_DIR, ["page.tsx"]).map(relative)

  // Страницы входа и регистрации открыты намеренно, страница «нет компании»
  // проверяет сессию сама и не должна требовать привязки к компании.
  const PUBLIC_PAGES = ["app/sign-in/page.tsx", "app/sign-up/page.tsx", "app/no-company/page.tsx"]

  it("каждая страница с данными требует входа", () => {
    const unprotected = pages.filter((path) => {
      if (PUBLIC_PAGES.includes(path)) return false
      return !SESSION_GUARDS.test(readFileSync(join(process.cwd(), path), "utf8"))
    })

    expect(unprotected).toEqual([])
  })

  it("страницы входа и экран без компании тоже смотрят на сессию", () => {
    // Вошедшего человека нельзя оставлять на странице входа, а на странице
    // «нет компании» — держать после выдачи привязки.
    for (const path of PUBLIC_PAGES) {
      expect(SESSION_GUARDS.test(readFileSync(join(process.cwd(), path), "utf8"))).toBe(true)
    }
  })
})

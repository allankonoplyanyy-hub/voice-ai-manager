import { describe, expect, it } from "vitest"

import { DEMO_SCENARIOS, getScenario } from "@/lib/voice/scenarios"

/**
 * Сценарии несут собственный companyId, и раньше он попадал в базу как есть.
 * Это позволяло любому вошедшему записать звонок в чужую компанию: достаточно
 * было указать её scenarioId. Дыра подтверждалась на живом приложении — аккаунт
 * школы записал звонок в clinic-almaty.
 *
 * Тесты фиксируют предпосылку той дыры: сценарии действительно принадлежат
 * разным компаниям, поэтому сверка с сессией обязательна и не может быть
 * «оптимизирована» как избыточная.
 */
describe("принадлежность сценариев компаниям", () => {
  it("сценарии распределены минимум по двум компаниям", () => {
    const companies = new Set(DEMO_SCENARIOS.map((s) => s.companyId))
    expect(companies.size).toBeGreaterThan(1)
  })

  it("у каждого сценария указана компания", () => {
    for (const scenario of DEMO_SCENARIOS) {
      expect(scenario.companyId, `сценарий ${scenario.id} без компании`).toBeTruthy()
    }
  })

  it("сценарий клиники не принадлежит школе", () => {
    const clinic = DEMO_SCENARIOS.find((s) => s.companyId === "clinic-almaty")
    expect(clinic).toBeDefined()
    expect(clinic?.companyId).not.toBe("school-astana")
  })

  it("getScenario не фильтрует по компании сам по себе", () => {
    // Важная деталь: getScenario отдаёт сценарий любой компании. Значит,
    // проверка обязана быть в маршруте, и полагаться на выборку нельзя.
    const clinic = DEMO_SCENARIOS.find((s) => s.companyId === "clinic-almaty")!
    expect(getScenario(clinic.id)?.companyId).toBe("clinic-almaty")
  })
})

/**
 * Проверка самих маршрутов: сверка companyId сценария с сессией должна
 * присутствовать в коде каждого маршрута, который пишет звонки.
 */
describe("маршруты записи звонков сверяют компанию сценария", () => {
  const ROUTES = ["app/api/voice/calls/route.ts", "app/api/voice/demo/run/route.ts"]

  it.each(ROUTES)("%s сравнивает scenario.companyId с ctx.companyId", async (route) => {
    const { readFile } = await import("node:fs/promises")
    const source = await readFile(route, "utf8")

    expect(source).toMatch(/scenario\.companyId\s*!==\s*ctx\.companyId/)
  })

  it.each(ROUTES)("%s отвечает 404, а не 403, на чужой сценарий", async (route) => {
    const { readFile } = await import("node:fs/promises")
    const source = await readFile(route, "utf8")

    // Ответ 403 подтвердил бы существование чужой компании. Ожидается 404 —
    // такой же ответ, как на несуществующий сценарий.
    const guard = source.split("scenario.companyId")[1]?.slice(0, 600) ?? ""
    expect(guard).toContain("404")
    expect(guard).not.toContain("403")
  })
})

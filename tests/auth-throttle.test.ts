import { beforeEach, describe, expect, it } from "vitest"
import {
  UNKNOWN_IP,
  classifyAuthRequest,
  clientIp,
  normalizeEmail,
  refundAuthAttempt,
  resetAuthThrottle,
  throttleAuthAttempt,
} from "@/lib/auth-throttle"

const headers = (init: Record<string, string>) => new Headers(init)

describe("определение адреса клиента", () => {
  it("берёт x-real-ip, который проставляет платформа", () => {
    expect(clientIp(headers({ "x-real-ip": "203.0.113.7" }))).toBe("203.0.113.7")
  })

  it("КРИТИЧНО: не верит адресу, который клиент дописал сам", () => {
    // Клиент прислал свой x-forwarded-for, платформа дописала настоящий адрес
    // справа. Если взять левый элемент, лимит обходится подстановкой нового
    // значения в каждый запрос — то есть перебор пароля ничем не сдержан.
    const ip = clientIp(headers({ "x-forwarded-for": "9.9.9.9, 203.0.113.7" }))
    expect(ip).toBe("203.0.113.7")
    expect(ip).not.toBe("9.9.9.9")
  })

  it("x-real-ip важнее x-forwarded-for", () => {
    const ip = clientIp(headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "9.9.9.9" }))
    expect(ip).toBe("203.0.113.7")
  })

  it("без заголовков возвращает общий ключ, а не пустую строку", () => {
    // Пустой ключ склеил бы всех в одно ведро незаметно; явное значение видно
    // в журнале и его поведение описано.
    expect(clientIp(headers({}))).toBe(UNKNOWN_IP)
  })
})

describe("публичная регистрация закрыта", () => {
  /**
   * Точка /api/auth/sign-up/email создавала аккаунт по почте и паролю, минуя
   * код приглашения: проверка кода живёт в серверном действии. Дыра
   * подтверждалась на живом приложении — пять аккаунтов с заведомо неверным
   * кодом были созданы подряд.
   */
  it("КРИТИЧНО: маршрут отклоняет прямые запросы регистрации", async () => {
    const { readFile } = await import("node:fs/promises")
    const source = await readFile("app/api/auth/[...all]/route.ts", "utf8")

    const guard = source.slice(source.indexOf('kind === "sign-up"'))
    expect(guard).toContain("404")
    // Ответ не должен доходить до обработчика Better Auth.
    expect(guard.slice(0, 300)).not.toContain("handler.POST")
  })

  it("серверное действие ограничивает перебор кодов приглашения", async () => {
    const { readFile } = await import("node:fs/promises")
    const source = await readFile("app/sign-up/actions.ts", "utf8")

    expect(source).toContain("signUpLimiter.check")
    // Лимит обязан стоять до занятия слота приглашения, иначе перебор успевает
    // израсходовать чужие приглашения.
    expect(source.indexOf("signUpLimiter.check")).toBeLessThan(source.indexOf(".update(voiceInvites)"))
  })

  it("успешная регистрация расходует лимит, а успешный вход — нет", async () => {
    const { readFile } = await import("node:fs/promises")
    const source = await readFile("app/api/auth/[...all]/route.ts", "utf8")

    // Возврат токена только для входа: иначе счётчик регистраций не
    // исчерпывался бы никогда.
    expect(source).toMatch(/refundAuthAttempt/)
    expect(source).toMatch(/kind === "sign-in"/)
  })
})

describe("отнесение запроса к попытке входа", () => {
  it("узнаёт вход и регистрацию", () => {
    expect(classifyAuthRequest("POST", "/api/auth/sign-in/email")).toBe("sign-in")
    expect(classifyAuthRequest("POST", "/api/auth/sign-up/email")).toBe("sign-up")
  })

  it("не ограничивает выход и чтение сессии", () => {
    // Эти запросы идут на каждой странице. Попади они под лимит, работа в
    // системе прекращалась бы сама собой через несколько переходов.
    expect(classifyAuthRequest("POST", "/api/auth/sign-out")).toBe("other")
    expect(classifyAuthRequest("GET", "/api/auth/get-session")).toBe("other")
  })
})

describe("нормализация почты", () => {
  it("приводит регистр и убирает пробелы", () => {
    expect(normalizeEmail("  Dana@School.KZ ")).toBe("dana@school.kz")
  })

  it("пустое значение считается отсутствующим", () => {
    expect(normalizeEmail("   ")).toBeNull()
    expect(normalizeEmail(undefined)).toBeNull()
    expect(normalizeEmail(42)).toBeNull()
  })
})

describe("лимит попыток входа", () => {
  beforeEach(() => resetAuthThrottle())

  const attempt = (ip: string, email: string | null, now?: number) =>
    throttleAuthAttempt({ kind: "sign-in", ip, email, now })

  it("КРИТИЧНО: перебор пароля останавливается", () => {
    const ip = "203.0.113.7"
    const email = "dana@school.kz"

    for (let i = 0; i < 5; i++) {
      expect(attempt(ip, email).allowed, `попытка ${i + 1}`).toBe(true)
    }

    const blocked = attempt(ip, email)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThan(0)
  })

  it("КРИТИЧНО: перебор по многим адресам почты тоже останавливается", () => {
    // Лимит на пару здесь не срабатывает ни разу: каждая почта пробуется
    // единожды. Останавливать такой перебор должен лимит на адрес.
    const ip = "203.0.113.7"
    let blockedAt = -1

    for (let i = 0; i < 40; i++) {
      if (!attempt(ip, `user${i}@example.com`).allowed) {
        blockedAt = i
        break
      }
    }

    expect(blockedAt).toBeGreaterThan(0)
    expect(blockedAt).toBeLessThanOrEqual(20)
  })

  it("посторонний не может закрыть вход настоящему владельцу", () => {
    // Лимит привязан к паре «адрес + почта». Расход чужого лимита с другого
    // адреса не должен мешать владельцу войти со своего.
    const email = "dana@school.kz"
    for (let i = 0; i < 10; i++) attempt("198.51.100.1", email)

    expect(attempt("203.0.113.7", email).allowed).toBe(true)
  })

  it("удачный вход не расходует лимит", () => {
    const ip = "203.0.113.7"
    const email = "dana@school.kz"

    for (let i = 0; i < 20; i++) {
      const decision = attempt(ip, email)
      expect(decision.allowed, `вход ${i + 1}`).toBe(true)
      refundAuthAttempt(decision)
    }
  })

  it("лимит отпускает со временем", () => {
    const ip = "203.0.113.7"
    const email = "dana@school.kz"
    const start = 1_000_000

    for (let i = 0; i < 5; i++) attempt(ip, email, start)
    expect(attempt(ip, email, start).allowed).toBe(false)

    // Пополнение — одна попытка в минуту.
    expect(attempt(ip, email, start + 61_000).allowed).toBe(true)
  })

  it("запрос без почты расходует лимит на адрес", () => {
    const ip = "203.0.113.7"
    let blockedAt = -1

    for (let i = 0; i < 40; i++) {
      if (!attempt(ip, null).allowed) {
        blockedAt = i
        break
      }
    }

    expect(blockedAt).toBeGreaterThan(0)
  })
})

describe("лимит регистраций", () => {
  beforeEach(() => resetAuthThrottle())

  it("КРИТИЧНО: код приглашения нельзя перебирать", () => {
    // Рабочий код открывает доступ к звонкам компании, поэтому скорость
    // попыток здесь важнее удобства.
    const ip = "203.0.113.7"
    let blockedAt = -1

    for (let i = 0; i < 10; i++) {
      const decision = throttleAuthAttempt({ kind: "sign-up", ip, email: `u${i}@e.com` })
      if (!decision.allowed) {
        blockedAt = i
        break
      }
    }

    expect(blockedAt).toBeGreaterThan(0)
    expect(blockedAt).toBeLessThanOrEqual(3)
  })

  it("регистрации с другого адреса не затронуты", () => {
    const ip = "203.0.113.7"
    for (let i = 0; i < 5; i++) {
      throttleAuthAttempt({ kind: "sign-up", ip, email: `u${i}@e.com` })
    }

    const other = throttleAuthAttempt({ kind: "sign-up", ip: "198.51.100.1", email: "a@e.com" })
    expect(other.allowed).toBe(true)
  })
})

import { betterAuth } from "better-auth"
import { pool } from "@/lib/db"

// Пул соединений общий с Drizzle: одно подключение к базе и один источник истины.
export const auth = betterAuth({
  database: pool,
  baseURL:
    process.env.BETTER_AUTH_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.V0_RUNTIME_URL),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 12,
  },
  // Better Auth отклоняет cookie с источников вне этого списка, поэтому здесь
  // перечислены все окружения: превью, текущий деплой и продакшен.
  trustedOrigins: [
    ...(process.env.V0_RUNTIME_URL ? [process.env.V0_RUNTIME_URL] : []),
    ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
    ...(process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? [`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`]
      : []),
    // Превью-песочница выдаётся на одноразовом поддомене, который заранее
    // неизвестен и не совпадает с V0_RUNTIME_URL. Маски добавляются только в
    // dev: в продакшене доверять целому домену нельзя.
    ...(process.env.NODE_ENV === "development"
      ? ["https://*.vercel.run", "https://*.vusercontent.net"]
      : []),
  ],
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  ...(process.env.NODE_ENV === "development"
    ? {
        advanced: {
          // Превью открывается во вложенном фрейме с другого домена. Без этих
          // атрибутов браузер молча выбрасывает cookie сессии и вход не держится.
          defaultCookieAttributes: {
            sameSite: "none" as const,
            secure: true,
          },
        },
      }
    : {}),
})

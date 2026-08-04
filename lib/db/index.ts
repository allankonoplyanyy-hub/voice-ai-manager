import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import * as schema from "./schema"

// Один пул на процесс. В dev Next.js перезагружает модули, поэтому кэшируем в globalThis,
// иначе каждый HMR-цикл открывает новый пул и Neon упирается в лимит соединений.
const globalForDb = globalThis as unknown as { voicePool?: Pool }

function createPool() {
  const raw = process.env.DATABASE_URL
  if (!raw) {
    throw new Error("DATABASE_URL не задан — база данных недоступна")
  }

  // sslmode из строки подключения убирается, а TLS задаётся явно.
  // Причина: pg трактует sslmode=require как verify-full, но в pg v9 семантика
  // станет слабее (без проверки цепочки и хоста). Явный rejectUnauthorized
  // фиксирует полную проверку сертификата и снимает предупреждение о переходе.
  const url = new URL(raw)
  url.searchParams.delete("sslmode")
  url.searchParams.delete("uselibpqcompat")

  return new Pool({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true },
    max: 10,
    idleTimeoutMillis: 30_000,
  })
}

export const pool = globalForDb.voicePool ?? createPool()
// Кэш нужен только dev-серверу с HMR. В тестах он вреден: между файлами Vitest
// сбрасывает модули, но globalThis сохраняется, поэтому файл, закрывший пул
// через pool.end(), оставлял бы следующему файлу уже закрытое соединение.
if (process.env.NODE_ENV === "development") globalForDb.voicePool = pool

export const db = drizzle(pool, { schema })

/** Есть ли вообще сконфигурированная база. Используется health-чеком и режимами. */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL)
}

/** Пинг базы для readiness-проб. Не бросает исключение. */
export async function pingDatabase(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now()
  try {
    await pool.query("SELECT 1")
    return { ok: true, latencyMs: Date.now() - start }
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : "unknown error",
    }
  }
}

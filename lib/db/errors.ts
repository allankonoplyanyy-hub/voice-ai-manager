// Разбор ошибок Postgres.
//
// Драйвер pg отдаёт код в error.code, но Drizzle оборачивает ошибку в
// DrizzleQueryError и кладёт исходную в cause. Проверка только верхнего уровня
// пропускает нарушение уникальности, из-за чего гонка выглядит как «сервис
// недоступен» (retryable) вместо «слот занят»/«дубликат» (терминальное).
// Реализация одна на весь проект, чтобы дефект не размножался по копиям.

/** unique_violation, класс 23 — integrity_constraint_violation. */
export const PG_UNIQUE_VIOLATION = "23505"

const MAX_CAUSE_DEPTH = 5

/** Извлекает код ошибки Postgres, обходя цепочку cause. */
export function pgErrorCode(error: unknown): string | null {
  let current: unknown = error
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current !== null && typeof current === "object"; depth++) {
    const code = (current as { code?: unknown }).code
    if (typeof code === "string" && code.length > 0) return code
    current = (current as { cause?: unknown }).cause
  }
  return null
}

export function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === PG_UNIQUE_VIOLATION
}

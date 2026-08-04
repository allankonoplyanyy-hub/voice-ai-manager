import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Тесты, требующие БД, помечены и пропускаются при отсутствии DATABASE_URL,
    // поэтому набор всегда запускаем целиком.
    passWithNoTests: false,
    // Интеграционные файлы работают с одной и той же базой, а часть функций
    // (например, захват событий из outbox) не ограничена одним арендатором.
    // При параллельном запуске файлы видят чужие строки, и результат зависит от
    // случайного порядка. Последовательный прогон медленнее, но воспроизводим.
    fileParallelism: false,
    reporters: ["default"],
  },
  resolve: {
    alias: { "@": resolve(__dirname, ".") },
  },
})

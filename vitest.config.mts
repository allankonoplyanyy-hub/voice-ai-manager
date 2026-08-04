import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Тесты, требующие БД, помечены и пропускаются при отсутствии DATABASE_URL,
    // поэтому набор всегда запускаем целиком.
    passWithNoTests: false,
    reporters: ["default"],
  },
  resolve: {
    alias: { "@": resolve(__dirname, ".") },
  },
})

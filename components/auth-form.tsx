"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Bot } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * Единая форма входа и регистрации.
 *
 * Сообщения об ошибках намеренно обобщённые: по ответу нельзя определить,
 * существует ли аккаунт с таким адресом, иначе форма превращается в способ
 * проверять базу клиентов на наличие конкретного email.
 */
export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const isSignUp = mode === "sign-up"

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error: authError } = isSignUp
      ? await authClient.signUp.email({ email, password, name })
      : await authClient.signIn.email({ email, password })

    setLoading(false)

    if (authError) {
      setError(
        isSignUp
          ? "Не удалось создать аккаунт. Проверьте данные и попробуйте снова."
          : "Неверный email или пароль.",
      )
      return
    }

    router.push("/")
    router.refresh()
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-gold text-gold-foreground">
            <Bot className="size-6" aria-hidden="true" />
          </span>
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight text-balance">
              {isSignUp ? "Создание аккаунта" : "Вход в кабинет"}
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
              {isSignUp
                ? "Аккаунт нужен, чтобы видеть звонки и заявки только своей компании."
                : "Голосовой ассистент: звонки, заявки, записи и аналитика."}
            </p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6"
        >
          {isSignUp && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Имя</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
                placeholder="Айдана Смагулова"
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Рабочий email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@company.kz"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Пароль</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={isSignUp ? "new-password" : "current-password"}
            />
            {isSignUp && (
              <p className="text-xs text-muted-foreground">Не короче 8 символов.</p>
            )}
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Подождите..." : isSignUp ? "Создать аккаунт" : "Войти"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          {isSignUp ? "Уже есть аккаунт? " : "Ещё нет аккаунта? "}
          <Link
            href={isSignUp ? "/sign-in" : "/sign-up"}
            className="font-medium text-foreground underline underline-offset-4"
          >
            {isSignUp ? "Войти" : "Зарегистрироваться"}
          </Link>
        </p>
      </div>
    </main>
  )
}

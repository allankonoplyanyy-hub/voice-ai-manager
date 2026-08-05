import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { Building2 } from "lucide-react"
import { SignOutButton } from "@/components/sign-out-button"
import { auth } from "@/lib/auth"
import { getAuthContext } from "@/lib/auth-context"

export const metadata = { title: "Нет доступа к компании — AAA Voice AI Manager" }

export const dynamic = "force-dynamic"

/**
 * Экран для аккаунта, который вошёл, но ещё не привязан ни к одной компании.
 *
 * Такой пользователь не должен попадать на страницу входа: сессия у него уже
 * есть, и редирект туда закончился бы циклом.
 */
export default async function NoCompanyPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect("/sign-in")

  // Привязку могли выдать уже после входа — тогда держать человека здесь незачем.
  const ctx = await getAuthContext()
  if (ctx) redirect("/")

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <Building2 className="size-6" aria-hidden="true" />
        </span>

        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-balance">
            Аккаунт не привязан к компании
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
            Вход выполнен как {session.user.email}, но этот аккаунт пока не связан ни с одной
            компанией. Данные звонков открываются только сотрудникам конкретной компании, поэтому
            доступ закрыт до выдачи прав.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
            Привязка выдаётся по коду приглашения от компании. Запросите код у администратора и
            зарегистрируйтесь с ним, либо попросите добавить этот аккаунт вручную.
          </p>
        </div>

        <SignOutButton />
      </div>
    </main>
  )
}

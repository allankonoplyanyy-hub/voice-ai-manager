"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { LogOut } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"

export function SignOutButton({
  variant = "outline",
  className,
}: {
  variant?: "outline" | "ghost"
  className?: string
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const handleSignOut = async () => {
    setLoading(true)
    await authClient.signOut()
    // refresh() нужен, чтобы серверные страницы перечитали уже удалённую сессию.
    router.push("/sign-in")
    router.refresh()
  }

  return (
    <Button variant={variant} onClick={handleSignOut} disabled={loading} className={className}>
      <LogOut className="size-4" aria-hidden="true" />
      {loading ? "Выходим..." : "Выйти"}
    </Button>
  )
}

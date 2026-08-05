import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { AuthForm } from "@/components/auth-form"
import { auth } from "@/lib/auth"

export const metadata = { title: "Регистрация — AAA Voice AI Manager" }

export const dynamic = "force-dynamic"

export default async function SignUpPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (session?.user) redirect("/")
  return <AuthForm mode="sign-up" />
}

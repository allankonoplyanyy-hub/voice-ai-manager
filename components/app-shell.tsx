"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import {
  BarChart3,
  BookOpen,
  Bot,
  CalendarDays,
  LayoutDashboard,
  ListTree,
  Menu,
  Phone,
  PlayCircle,
  Plug,
  Settings,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"

const NAV = [
  { href: "/", label: "Обзор", icon: LayoutDashboard },
  { href: "/calls", label: "Звонки", icon: Phone },
  { href: "/demo", label: "Live Demo", icon: PlayCircle },
  { href: "/assistants", label: "Ассистенты", icon: Bot },
  { href: "/knowledge", label: "База знаний", icon: BookOpen },
  { href: "/scenarios", label: "Сценарии", icon: ListTree },
  { href: "/calendar", label: "Календарь", icon: CalendarDays },
  { href: "/integrations", label: "Интеграции", icon: Plug },
  { href: "/analytics", label: "Аналитика", icon: BarChart3 },
  { href: "/settings", label: "Настройки", icon: Settings },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href)

  const nav = (
    <nav className="flex flex-col gap-1" aria-label="Основная навигация">
      {NAV.map((item) => {
        const Icon = item.icon
        const active = isActive(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )

  const brand = (
    <Link href="/" className="flex items-center gap-2 px-3" onClick={() => setMobileOpen(false)}>
      <span className="flex size-8 items-center justify-center rounded-lg bg-gold text-gold-foreground text-xs font-bold tracking-wide">
        AAA
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-semibold text-foreground">Voice AI Manager</span>
        <span className="text-xs text-muted-foreground">Demo-режим</span>
      </span>
    </Link>
  )

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar py-5 px-3">
        {brand}
        {nav}
        <div className="mt-auto px-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Телефония не подключена. Все звонки — имитация demo-сценариев.
          </p>
        </div>
      </aside>

      {/* Mobile header + drawer */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-border bg-sidebar px-4 py-3 md:hidden">
          {brand}
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? "Закрыть меню" : "Открыть меню"}
            className="flex size-9 items-center justify-center rounded-lg border border-border text-foreground"
          >
            {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </header>
        {mobileOpen && (
          <div className="border-b border-border bg-sidebar p-3 md:hidden">{nav}</div>
        )}
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  )
}

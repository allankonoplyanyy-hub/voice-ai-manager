import { NextResponse } from "next/server"
import { DEMO_TENANTS } from "@/lib/voice/tenants"

export async function GET() {
  return NextResponse.json({ tenants: DEMO_TENANTS })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body?.companyId || !body?.name) {
    return NextResponse.json(
      { error: "companyId и name обязательны" },
      { status: 400 },
    )
  }
  // Demo-режим: создание тенанта имитируется, постоянное хранилище отсутствует.
  return NextResponse.json(
    { status: "mock_created", companyId: body.companyId },
    { status: 201 },
  )
}

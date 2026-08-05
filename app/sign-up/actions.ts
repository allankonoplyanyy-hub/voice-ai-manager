"use server"

import { randomUUID } from "node:crypto"
import { and, eq, isNull, or, sql } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { voiceCompanyMembers, voiceInvites } from "@/lib/db/schema"

export type SignUpResult = { ok: true } | { ok: false; error: string }

/**
 * Регистрация по коду приглашения.
 *
 * Компания и роль берутся из записи приглашения в базе, а не из данных формы:
 * иначе достаточно было бы подменить поле в запросе, чтобы записаться в чужую
 * компанию и получить доступ к её звонкам.
 */
export async function signUpWithInvite(input: {
  name: string
  email: string
  password: string
  code: string
}): Promise<SignUpResult> {
  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()
  const code = input.code.trim().toUpperCase()

  if (!name || !email || !input.password || !code) {
    return { ok: false, error: "Заполните все поля." }
  }

  // Слот приглашения занимается одним атомарным UPDATE. Проверка «сначала
  // прочитать, потом увеличить» позволяла бы двум одновременным регистрациям
  // израсходовать один и тот же последний слот.
  const reserved = await db
    .update(voiceInvites)
    .set({ usedCount: sql`${voiceInvites.usedCount} + 1` })
    .where(
      and(
        eq(voiceInvites.code, code),
        sql`${voiceInvites.usedCount} < ${voiceInvites.maxUses}`,
        or(isNull(voiceInvites.expiresAt), sql`${voiceInvites.expiresAt} > now()`),
      ),
    )
    .returning({ companyId: voiceInvites.companyId, role: voiceInvites.role })

  const invite = reserved[0]
  if (!invite) {
    // Намеренно один и тот же текст для неизвестного, просроченного и
    // исчерпанного кода: по разным сообщениям можно было бы подбирать
    // существующие коды.
    return { ok: false, error: "Код приглашения недействителен или уже использован." }
  }

  try {
    const created = await auth.api.signUpEmail({
      body: { name, email, password: input.password },
    })

    await db.insert(voiceCompanyMembers).values({
      id: randomUUID(),
      userId: created.user.id,
      companyId: invite.companyId,
      role: invite.role,
    })

    return { ok: true }
  } catch (error) {
    // Аккаунт не создан — слот возвращается, иначе неудачные попытки
    // постепенно «съели» бы приглашение.
    await db
      .update(voiceInvites)
      .set({ usedCount: sql`greatest(${voiceInvites.usedCount} - 1, 0)` })
      .where(eq(voiceInvites.code, code))

    const message = error instanceof Error ? error.message : ""
    if (/already exists|existing user|USER_ALREADY_EXISTS/i.test(message)) {
      return { ok: false, error: "Пользователь с таким email уже зарегистрирован." }
    }
    if (/password/i.test(message)) {
      return { ok: false, error: "Пароль должен содержать не менее 12 символов." }
    }

    console.log("[voice] sign-up: ошибка регистрации:", message)
    return { ok: false, error: "Не удалось завершить регистрацию. Попробуйте ещё раз." }
  }
}

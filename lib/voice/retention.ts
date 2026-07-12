import type { VoiceCall } from "./types"

// Transcript retention: политика хранения транскриптов.
// По истечении срока транскрипт очищается, но метаданные звонка
// (итог, лид, запись, метрики) сохраняются — аналитика не ломается.

export const DEFAULT_RETENTION_DAYS = 90

export function getRetentionDays(): number {
  const env = process.env.VOICE_TRANSCRIPT_RETENTION_DAYS
  const parsed = env ? Number.parseInt(env, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS
}

export function isTranscriptExpired(call: Pick<VoiceCall, "startedAt">, now = Date.now(), retentionDays = getRetentionDays()): boolean {
  const started = Date.parse(call.startedAt)
  if (Number.isNaN(started)) return false
  return now - started > retentionDays * 86400_000
}

export interface RetentionResult {
  scanned: number
  purged: number
}

/**
 * Очищает транскрипты звонков старше retention-окна.
 * Мутирует переданные объекты (in-memory store), метаданные не трогает.
 */
export function purgeExpiredTranscripts(
  calls: Iterable<VoiceCall>,
  now = Date.now(),
  retentionDays = getRetentionDays(),
): RetentionResult {
  let scanned = 0
  let purged = 0
  for (const call of calls) {
    scanned++
    if (call.transcript.length > 0 && isTranscriptExpired(call, now, retentionDays)) {
      call.transcript = []
      call.summary = `${call.summary} [Транскрипт удалён по политике хранения: ${retentionDays} дн.]`
      purged++
    }
  }
  return { scanned, purged }
}

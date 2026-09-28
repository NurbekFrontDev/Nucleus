// MediaRecorder-обёртка для голосовых записей дневника.
// Выбирает лучший поддерживаемый mime (webm/opus в Chrome/WebView2 и Android
// Chrome, фолбэк mp4 на части Android) и держит запись в рамках 15 минут
// (лимит inline-аудио Gemini). Дизайн — процедурный, один активный клип.

export type RecordResult = {
  blob: Blob
  mime: string
  ext: string
  durationMs: number
}

type ActiveRecording = {
  recorder: MediaRecorder
  stream: MediaStream
  chunks: Blob[]
  mime: string
  startedAt: number
  autoTimer: number | undefined
}

const MAX_MS = 15 * 60 * 1000

let active: ActiveRecording | null = null

function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m
    } catch {
      // isTypeSupported может отсутствовать — попробуем без явного mime
    }
  }
  return null
}

/** Доступна ли голосовая запись в этом окружении. */
export function isRecordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'
  )
}

/** Сколько идёт текущая запись (мс); 0 — если запись не активна. */
export function recordingElapsedMs(): number {
  return active ? Date.now() - active.startedAt : 0
}

/**
 * Стартует запись. Бросает Error с кодом 'mic-denied' (нет разрешения) или
 * 'mic-unavailable' (нет микрофона/API). onAutoStop срабатывает при
 * достижении лимита 15 минут — результат приходит в колбэк.
 */
export async function startRecording(onAutoStop?: (r: RecordResult) => void): Promise<void> {
  if (active) return
  if (!isRecordingSupported()) throw new Error('mic-unavailable')

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (e) {
    const name = (e as DOMException)?.name ?? ''
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new Error('mic-denied', { cause: e })
    }
    throw new Error('mic-unavailable', { cause: e })
  }

  const mime = pickMimeType()
  let recorder: MediaRecorder
  try {
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  } catch {
    try {
      recorder = new MediaRecorder(stream)
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop())
      throw new Error('mic-unavailable', { cause: e })
    }
  }

  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data)
  }
  // Кусок каждую секунду: длинные клипы не теряются при сбое WebView.
  recorder.start(1000)

  const rec: ActiveRecording = {
    recorder,
    stream,
    chunks,
    mime: recorder.mimeType || mime || 'audio/webm',
    startedAt: Date.now(),
    autoTimer: undefined,
  }
  active = rec

  if (onAutoStop) {
    rec.autoTimer = window.setTimeout(() => {
      void stopRecording()
        .then((r) => onAutoStop(r))
        .catch(() => {})
    }, MAX_MS)
  }
}

/**
 * Останавливает запись и возвращает клип. Без активной записи бросает
 * 'not-recording'.
 */
export async function stopRecording(): Promise<RecordResult> {
  const rec = active
  if (!rec) throw new Error('not-recording')
  active = null
  if (rec.autoTimer !== undefined) window.clearTimeout(rec.autoTimer)

  await new Promise<void>((resolve) => {
    rec.recorder.onstop = () => resolve()
    try {
      rec.recorder.stop()
    } catch {
      resolve()
    }
  })
  rec.stream.getTracks().forEach((t) => t.stop())

  const blob = new Blob(rec.chunks, { type: rec.mime })
  const ext = rec.mime.includes('mp4') ? 'm4a' : 'webm'
  return { blob, mime: rec.mime, ext, durationMs: Date.now() - rec.startedAt }
}

/** Отменяет запись без результата (клик мимо, размонтирование экрана). */
export function cancelRecording(): void {
  const rec = active
  if (!rec) return
  active = null
  if (rec.autoTimer !== undefined) window.clearTimeout(rec.autoTimer)
  try {
    rec.recorder.onstop = null
    rec.recorder.stop()
  } catch {
    // уже остановлен
  }
  rec.stream.getTracks().forEach((t) => t.stop())
}

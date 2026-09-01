// ====================================================================
// Минималистичные звуковые эффекты (Web Audio API).
// Синтезируются на лету: 0 байт внешних файлов, нулевая задержка,
// стабильная работа на Web, Desktop (Tauri) и Android (Capacitor WebView).
// ====================================================================

let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return null
    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx = new AudioCtx()
    }
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume()
    }
    return audioCtx
  } catch {
    return null
  }
}

/**
 * Воспроизводит мягкий, кристально чистый минималистичный звук завершения задачи / привычки.
 * Двухтональный гармоничный колокольчик (D5 -> A5) с экспоненциальным затуханием за 200 мс.
 */
export function playTaskCompleteSound(): void {
  try {
    const ctx = getAudioContext()
    if (!ctx) return

    const now = ctx.currentTime

    // 1. Основной мягкий тон (синусоида с плавным переходом вверх D5 -> A5)
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()

    osc1.type = 'sine'
    osc1.frequency.setValueAtTime(587.33, now) // D5
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.07) // A5

    gain1.gain.setValueAtTime(0.001, now)
    gain1.gain.linearRampToValueAtTime(0.14, now + 0.015)
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.22)

    osc1.connect(gain1)
    gain1.connect(ctx.destination)

    osc1.start(now)
    osc1.stop(now + 0.23)

    // 2. Вторая гармоника (хрустальный оттенок D6)
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()

    osc2.type = 'triangle'
    osc2.frequency.setValueAtTime(1174.66, now + 0.03) // D6

    gain2.gain.setValueAtTime(0.001, now + 0.03)
    gain2.gain.linearRampToValueAtTime(0.06, now + 0.05)
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.22)

    osc2.connect(gain2)
    gain2.connect(ctx.destination)

    osc2.start(now + 0.03)
    osc2.stop(now + 0.23)
  } catch {
    // В некоторых окружениях автовоспроизведение звука может блокироваться до первого клика — тихо игнорируем
  }
}

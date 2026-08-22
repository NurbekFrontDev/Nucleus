// Модуль звуковых эффектов приложения (Web Audio API).
// Работает без внешних mp3-файлов, кроссплатформенно (Web / Android / Windows).

let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return null
    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx = new Ctx()
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
 * Воспроизводит приятный, гармоничный звук выполнения задачи (reward chime).
 * Мягкий перелив нот C5 -> E5 -> C6 с кристальным затуханием.
 */
export function playTaskDoneSound(): void {
  try {
    const ctx = getAudioContext()
    if (!ctx) return

    const now = ctx.currentTime

    // Основной мягкий тон (C5 -> E5)
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.type = 'sine'
    osc1.frequency.setValueAtTime(523.25, now)
    osc1.frequency.exponentialRampToValueAtTime(659.25, now + 0.08)

    gain1.gain.setValueAtTime(0.0001, now)
    gain1.gain.linearRampToValueAtTime(0.18, now + 0.02)
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.22)

    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.start(now)
    osc1.stop(now + 0.23)

    // Кристальный аккорд (C6 ~ 1046.5 Hz)
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = 'sine'
    osc2.frequency.setValueAtTime(1046.5, now + 0.06)

    gain2.gain.setValueAtTime(0.0001, now + 0.06)
    gain2.gain.linearRampToValueAtTime(0.22, now + 0.08)
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.45)

    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.start(now + 0.06)
    osc2.stop(now + 0.46)

    // Легкий стеклянный обертон (E6 ~ 1318.5 Hz) для глубины
    const osc3 = ctx.createOscillator()
    const gain3 = ctx.createGain()
    osc3.type = 'triangle'
    osc3.frequency.setValueAtTime(1318.51, now + 0.07)

    gain3.gain.setValueAtTime(0.0001, now + 0.07)
    gain3.gain.linearRampToValueAtTime(0.06, now + 0.09)
    gain3.gain.exponentialRampToValueAtTime(0.0001, now + 0.35)

    osc3.connect(gain3)
    gain3.connect(ctx.destination)
    osc3.start(now + 0.07)
    osc3.stop(now + 0.36)
  } catch {
    // Звук недоступен — тихо игнорируем
  }
}

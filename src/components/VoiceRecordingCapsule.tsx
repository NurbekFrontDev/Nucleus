import { useEffect, useRef, useState } from 'react'
import { getActiveAudioStream } from '../lib/recorder'
import { useLang } from '../lib/i18n'

// Адаптировано из Voxel (F:\Apps\Voxel\src\ui\floating_widget.cpp & audio_capture.cpp):
// 9 полос эквалайзера с колоколообразным весовым распределением (bell-curve)
// и быстрым Attack / мягким Release фильтром.
const BELL_WEIGHTS = [0.38, 0.65, 0.88, 0.98, 1.0, 0.98, 0.88, 0.65, 0.38]
const SILENCE_THRESHOLD_RMS = 0.012
const SILENCE_TRIGGER_MS = 3000

type VoiceRecordingCapsuleProps = {
  elapsedMs: number
  onCancel: () => void
  onConfirm: () => void
}

function fmtTimer(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const remS = s % 60
  return `${String(m).padStart(2, '0')}:${String(remS).padStart(2, '0')}`
}

export default function VoiceRecordingCapsule({
  elapsedMs,
  onCancel,
  onConfirm,
}: VoiceRecordingCapsuleProps) {
  const { t } = useLang()
  const [bands, setBands] = useState<number[]>(() => Array(9).fill(0.08))
  const [isSilent, setIsSilent] = useState(false)

  const smoothedRef = useRef<number[]>(Array(9).fill(0.08))
  const silenceStartRef = useRef<number | null>(null)
  const hasSpokenRef = useRef(false)

  useEffect(() => {
    const stream = getActiveAudioStream()
    if (!stream) return

    let audioCtx: AudioContext | null = null
    let source: MediaStreamAudioSourceNode | null = null
    let analyser: AnalyserNode | null = null
    let animId: number | null = null

    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      audioCtx = new AudioContextClass()

      if (audioCtx.state === 'suspended') {
        void audioCtx.resume()
      }

      source = audioCtx.createMediaStreamSource(stream)
      analyser = audioCtx.createAnalyser()
      analyser.fftSize = 64
      analyser.smoothingTimeConstant = 0.3
      source.connect(analyser)

      const timeDomainData = new Uint8Array(analyser.fftSize)
      const freqData = new Uint8Array(analyser.frequencyBinCount)
      const numBands = 9
      const chunkSize = Math.max(1, Math.floor(freqData.length / numBands))

      const render = () => {
        if (!analyser) return

        // 1. Вычисляем физический RMS громкости из временной области
        analyser.getByteTimeDomainData(timeDomainData)
        let sumSq = 0
        for (let i = 0; i < timeDomainData.length; i++) {
          const norm = (timeDomainData[i] - 128) / 128
          sumSq += norm * norm
        }
        const rms = Math.sqrt(sumSq / timeDomainData.length)

        // 2. Детектор тишины (Voxel Silence & Mic Diagnostic)
        const now = Date.now()
        if (rms < SILENCE_THRESHOLD_RMS) {
          if (silenceStartRef.current === null) {
            silenceStartRef.current = now
          } else if (now - silenceStartRef.current >= SILENCE_TRIGGER_MS) {
            setIsSilent(true)
          }
        } else {
          // Звук обнаружен — сбрасываем предупреждение
          hasSpokenRef.current = true
          silenceStartRef.current = null
          setIsSilent(false)
        }

        // 3. Расчёт multi-band эквалайзера (формула Voxel)
        analyser.getByteFrequencyData(freqData)
        const volBoost = Math.min(1.0, Math.max(0.0, Math.pow(rms * 18.0, 0.72)))
        const smoothed = smoothedRef.current

        for (let b = 0; b < numBands; b++) {
          const startIdx = b * chunkSize
          const endIdx = Math.min(startIdx + chunkSize, freqData.length)
          let bandEnergy = 0
          for (let i = startIdx; i < endIdx; i++) {
            bandEnergy += freqData[i] / 255.0
          }
          const avg = endIdx > startIdx ? bandEnergy / (endIdx - startIdx) : 0
          const bandFactor = Math.min(1.0, avg * 1.5)

          const targetH = Math.min(
            1.0,
            Math.max(
              0.08,
              0.08 + 0.92 * (volBoost * BELL_WEIGHTS[b] * (0.65 + 0.35 * bandFactor))
            )
          )

          // Smooth Attack (0.55) & Release (0.22)
          if (targetH > smoothed[b]) {
            smoothed[b] = smoothed[b] * 0.45 + targetH * 0.55
          } else {
            smoothed[b] = smoothed[b] * 0.78 + targetH * 0.22
          }
        }

        setBands([...smoothed])
        animId = requestAnimationFrame(render)
      }

      animId = requestAnimationFrame(render)
    } catch {
      // Фолбэк при отсутствии Web Audio API
    }

    return () => {
      if (animId !== null) cancelAnimationFrame(animId)
      if (source && analyser) {
        try {
          source.disconnect()
          analyser.disconnect()
        } catch {
          // Игнорируем
        }
      }
      if (audioCtx && audioCtx.state !== 'closed') {
        void audioCtx.close()
      }
    }
  }, [])

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Предупреждение о тишине / отключённом микрофоне */}
      {isSilent && (
        <div className="flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3.5 py-1 text-xs font-medium text-amber-300 shadow-sm backdrop-blur-md transition-all duration-300">
          <span className="text-amber-400">⚠️</span>
          <span>{t('diary.micNoAudio')}</span>
        </div>
      )}

      {/* Плавающий капсульный виджет Voxel */}
      <div
        role="region"
        aria-label="Audio recording controls"
        className="inline-flex h-11 items-center gap-3 rounded-full border border-neutral-700/60 bg-[#121317] px-2.5 shadow-xl transition-all"
      >
        {/* Левая кнопка: Отмена записи (✕) */}
        <button
          type="button"
          onClick={onCancel}
          title={t('diary.micCancel')}
          aria-label={t('diary.micCancel')}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-800 text-neutral-400 transition hover:bg-neutral-700 hover:text-red-400 active:scale-95"
        >
          <svg
            className="h-3 w-3"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          >
            <path d="M2.5 2.5l9 9M11.5 2.5l-9 9" />
          </svg>
        </button>

        {/* Центр: 9 полос эквалайзера Voxel + таймер */}
        <div className="flex items-center gap-2 px-1">
          <div className="flex h-6 items-center gap-[4.5px]">
            {bands.map((h, i) => {
              const heightPx = Math.max(3.5, Math.round(h * 20))
              return (
                <span
                  key={i}
                  className="w-[2.4px] rounded-full bg-neutral-100 transition-all duration-75"
                  style={{ height: `${heightPx}px` }}
                />
              )
            })}
          </div>

          <span className="font-mono text-xs font-medium tracking-wider text-neutral-400 select-none">
            {fmtTimer(elapsedMs)}
          </span>
        </div>

        {/* Правая кнопка: Подтвердить / Завершить (✓) */}
        <button
          type="button"
          onClick={onConfirm}
          title={t('diary.micStop')}
          aria-label={t('diary.micStop')}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-neutral-950 shadow transition hover:bg-neutral-200 active:scale-95"
        >
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2.8 7.2l3 3 5.5-6.5" />
          </svg>
        </button>
      </div>
    </div>
  )
}

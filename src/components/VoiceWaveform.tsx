import { useEffect, useRef, useState } from 'react'
import { getActiveAudioStream } from '../lib/recorder'

// 9 полос эквалайзера с весами колокольной кривой (bell-curve weights)
// и быстрым Attack (0.55) / плавным Release (0.22) фильтром.
const BELL_WEIGHTS = [0.38, 0.65, 0.88, 0.98, 1.0, 0.98, 0.88, 0.65, 0.38]
const VOICE_THRESHOLD_RMS = 0.015

export type MicIssue = 'muted' | 'disconnected' | 'no-signal' | null

type VoiceWaveformProps = {
  className?: string
  onIssueChange?: (issue: MicIssue) => void
}

export default function VoiceWaveform({ className = '', onIssueChange }: VoiceWaveformProps) {
  const [bands, setBands] = useState<number[]>(() => Array(9).fill(0.08))
  const smoothedRef = useRef<number[]>(Array(9).fill(0.08))
  const hasSpokenRef = useRef(false)
  const deadSignalStartRef = useRef<number | null>(null)

  useEffect(() => {
    const stream = getActiveAudioStream()
    if (!stream) return

    const track = stream.getAudioTracks()[0]
    const handleMute = () => onIssueChange?.('muted')
    const handleUnmute = () => onIssueChange?.(null)
    const handleEnded = () => onIssueChange?.('disconnected')

    if (track) {
      if (track.muted) {
        onIssueChange?.('muted')
      }
      track.addEventListener('mute', handleMute)
      track.addEventListener('unmute', handleUnmute)
      track.addEventListener('ended', handleEnded)
    }

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

        analyser.getByteTimeDomainData(timeDomainData)
        let sumSq = 0
        let isPureZero = true
        for (let i = 0; i < timeDomainData.length; i++) {
          const diff = timeDomainData[i] - 128
          if (diff !== 0) isPureZero = false
          const norm = diff / 128
          sumSq += norm * norm
        }
        const rms = Math.sqrt(sumSq / timeDomainData.length)

        // Проверка работоспособности микрофона:
        // Если зафиксирован звук речи — микрофон подтверждён как рабочий.
        const now = Date.now()
        if (rms >= VOICE_THRESHOLD_RMS) {
          if (!hasSpokenRef.current) {
            hasSpokenRef.current = true
            deadSignalStartRef.current = null
            onIssueChange?.(null)
          }
        } else if (!hasSpokenRef.current) {
          // Если пользователь ещё ни разу не говорил с момента старта записи,
          // проверяем, не отдаёт ли аудиопоток аппаратный мёртвый ноль
          if (isPureZero) {
            if (deadSignalStartRef.current === null) {
              deadSignalStartRef.current = now
            } else if (now - deadSignalStartRef.current >= 5000) {
              onIssueChange?.('no-signal')
            }
          }
        }
        // ВНИМАНИЕ: Если hasSpokenRef.current === true, паузы в речи нормальны —
        // никаких предупреждений о неработающем микрофоне не генерируется!

        // Расчёт эквалайзера для 9 полос
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
      // Игнорируем фолбэк при отсутствии Web Audio API
    }

    return () => {
      if (animId !== null) cancelAnimationFrame(animId)
      if (track) {
        track.removeEventListener('mute', handleMute)
        track.removeEventListener('unmute', handleUnmute)
        track.removeEventListener('ended', handleEnded)
      }
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
  }, [onIssueChange])

  return (
    <div
      className={`flex h-5 items-center gap-[3px] ${className}`}
      aria-label="Voice audio waveform"
    >
      {bands.map((h, i) => {
        const heightPx = Math.max(3, Math.round(h * 18))
        return (
          <span
            key={i}
            className="w-[2.5px] rounded-full bg-emerald-500 transition-all duration-75 dark:bg-emerald-400"
            style={{ height: `${heightPx}px` }}
          />
        )
      })}
    </div>
  )
}

// Генератор нашего минималистичного звука уведомления (WAV, без зависимостей).
// Запуск из корня проекта: node scripts/gen-notify-sound.mjs
// Результат: android/app/src/main/res/raw/notify_sound.wav
// Этот звук используется для сигнала окончания Помодоро (звук + вибрация)
// и для обычных напоминаний (только звук). Мягкий двухнотный аккорд.
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const SR = 44100
const notes = [
  { f: 660, t: 0.0, d: 0.2 },
  { f: 880, t: 0.14, d: 0.34 },
]
const total = 0.6
const n = Math.floor(SR * total)
const data = new Float32Array(n)
for (const note of notes) {
  const start = Math.floor(note.t * SR)
  const len = Math.floor(note.d * SR)
  for (let i = 0; i < len; i++) {
    const idx = start + i
    if (idx >= n) break
    const p = i / len
    const env = Math.min(1, p * 14) * Math.pow(1 - p, 2.4)
    data[idx] += Math.sin(2 * Math.PI * note.f * (i / SR)) * env * 0.6
  }
}
let peak = 0
for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(data[i]))
const g = peak > 0 ? 0.9 / peak : 1

const bytesPerSample = 2
const blockAlign = bytesPerSample
const byteRate = SR * blockAlign
const dataSize = n * bytesPerSample
const buf = Buffer.alloc(44 + dataSize)
buf.write('RIFF', 0)
buf.writeUInt32LE(36 + dataSize, 4)
buf.write('WAVE', 8)
buf.write('fmt ', 12)
buf.writeUInt32LE(16, 16)
buf.writeUInt16LE(1, 20)
buf.writeUInt16LE(1, 22)
buf.writeUInt32LE(SR, 24)
buf.writeUInt32LE(byteRate, 28)
buf.writeUInt16LE(blockAlign, 32)
buf.writeUInt16LE(16, 34)
buf.write('data', 36)
buf.writeUInt32LE(dataSize, 40)
for (let i = 0; i < n; i++) {
  let s = data[i] * g
  s = Math.max(-1, Math.min(1, s))
  buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2)
}
const out = 'android/app/src/main/res/raw/notify_sound.wav'
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, buf)
console.log('Готово:', out, buf.length, 'байт')

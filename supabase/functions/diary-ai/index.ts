// Supabase Edge Function: diary-ai
// AI-бэкенд модуля «Дневник» (сознательно отделён от ai-chat: свой промпт,
// свои провайдеры, ноль влияния на AI-бухгалтера FinLit).
//
// Операции (POST JSON, поле op):
//   op: "transcribe" { audioPath }  -> { transcript }
//     Аудио скачивается из приватного бакета diary-audio сервисным ключом
//     и отправляется в Gemini 3.5 Transcribe (аудио inline base64).
//   op: "summarize"  { text, activeExperiments } -> { summary }
//     Выжимка записи через LLM. Основной провайдер: Groq, модель
//     openai/gpt-oss-120b (секрет GROQ_API_KEY). Fallback: NVIDIA NIM,
//     meta/llama-3.3-70b-instruct (секрет NVIDIA_API_KEY).
//
// Аутентификация: Supabase JWT пользователя в Authorization header. Для
// transcribe дополнительно проверяется, что audioPath лежит внутри папки
// {user_id}/ — чужое аудио прочитать нельзя.
// Обработанные ошибки возвращаются со статусом 200 и полем error (паттерн ai-chat).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function reply(obj: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ===== Системный промпт выжимки (основа — проверенный промпт Echo) =====
const SUMMARY_SYSTEM_PROMPT = `Ты — персональный AI-ассистент, психолог и научный коуч в модуле «Дневник»
приложения Nucleus. Твоя задача — проанализировать запись пользователя
(голосовую, транскрибированную, или текстовую), структурировать её и сделать
емкую, вдохновляющую и полезную выжимку, а также АВТОМАТИЧЕСКИ отследить
прогресс личных экспериментов/челленджей, если пользователь упоминает их.

ПРАВИЛА ОБРАБОТКИ:
1. Выдели ключевые события (что произошло).
2. Выдели важные инсайты, размышления и выводы.
3. Выдели намеченные планы, задачи и дедлайны (Action items).
4. Оцени эмоциональный фон и уровень энергии от 1 до 10 (1 — упадок сил/стресс,
   10 — максимальная продуктивность и радость).
5. Придумай 2–4 ключевых тега.
6. АВТОМАТИЧЕСКОЕ РАСПОЗНАВАНИЕ ЭКСПЕРИМЕНТОВ/ЧЕЛЛЕНДЖЕЙ:
   - Если пользователь упоминает выполнение/нарушение активного эксперимента
     (список передан отдельно ниже) ИЛИ объявляет о старте нового
     (например: «начинаю 30 дней power nap», «решил 2 недели не пить кофе»):
     - Установи "has_experiment_update": true.
     - Сопоставь с существующим experiment_id из списка или отметь как новый.
     - Оцени соблюдение условий за сегодня (success_status: true/false).
     - Посчитай day_number (для нового — 1).
     - Дай ценный, мотивирующий совет коуча (coach_tip) с учётом динамики.
7. Пиши на языке записи пользователя. Оригинальные формулировки пользователя
   не оценивай и не исправляй — ты работаешь только со смыслом. Личные секреты
   и чувствительные детали в выжимку не выноси, ограничивайся смыслом.

СПИСОК АКТИВНЫХ ЭКСПЕРИМЕНТОВ (может быть пустым):
{active_experiments_json}

ФОРМАТ ОТВЕТА (СТРОГО ВАЛИДНЫЙ JSON БЕЗ ЛИШНЕГО ТЕКСТА И БЕЗ БЭКТИКОВ):
{
  "title": "Короткий заголовок записи (до 6-7 слов)",
  "summary_text": "Связный текст выжимки (2-4 предложения)",
  "key_events": ["Событие 1", "Событие 2"],
  "insights": ["Инсайт или вывод 1"],
  "action_items": ["Задача или план 1"],
  "mood_score": 8,
  "tags": ["продуктивность", "power_nap"],
  "experiment": {
    "has_experiment_update": true,
    "matched_experiment_id": "uuid-или-null",
    "is_new_experiment": false,
    "experiment_title": "Название эксперимента",
    "target_days": 30,
    "criteria": "Правила и критерии эксперимента",
    "day_number": 1,
    "success_status": true,
    "challenges_identified": "Трудности или 'Без сложностей'",
    "coach_tip": "Один персональный совет и поддержка от AI-коуча"
  }
}
Если экспериментов в записи нет — верни
"experiment": { "has_experiment_update": false }.`

// ===== Провайдеры выжимки (OpenAI-совместимый /chat/completions) =====
// Смена модели = правка этого блока или секрет GROQ_MODEL. Клиент про
// провайдера не знает ничего.
type LlmProvider = { name: string; baseUrl: string; apiKey: string; model: string }

function buildSummarizeProviders(): LlmProvider[] {
  const providers: LlmProvider[] = []
  const groqKey = Deno.env.get('GROQ_API_KEY')
  if (groqKey) {
    providers.push({
      name: 'groq',
      baseUrl: Deno.env.get('GROQ_BASE_URL') ?? 'https://api.groq.com/openai/v1',
      apiKey: groqKey,
      model: Deno.env.get('GROQ_MODEL') ?? 'openai/gpt-oss-120b',
    })
  }
  const nvidiaKey = Deno.env.get('NVIDIA_API_KEY')
  if (nvidiaKey) {
    providers.push({
      name: 'nvidia',
      baseUrl: Deno.env.get('NVIDIA_BASE_URL') ?? 'https://integrate.api.nvidia.com/v1',
      apiKey: nvidiaKey,
      model: Deno.env.get('NVIDIA_MODEL') ?? 'meta/llama-3.3-70b-instruct',
    })
  }
  return providers
}

// Один вызов /chat/completions. Возвращает текст либо причину неудачи.
async function callChat(
  p: LlmProvider,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
): Promise<{ text: string | null; detail?: string }> {
  try {
    const res = await fetch(p.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.apiKey },
      body: JSON.stringify({
        model: p.model,
        messages,
        temperature: 0.4,
        max_tokens: maxTokens,
        stream: false,
      }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { text: null, detail: `HTTP ${res.status} (${p.model}): ${t.slice(0, 200)}` }
    }
    const json = await res.json()
    const text = json?.choices?.[0]?.message?.content
    if (typeof text === 'string' && text.trim().length > 0) return { text }
    return { text: null, detail: `empty completion (${p.model})` }
  } catch (e) {
    return { text: null, detail: `${p.model}: ${String(e)}` }
  }
}

// Вытаскивает JSON из ответа модели (модели любят оборачивать ответ в ```json).
function extractJson(raw: string): unknown | null {
  let s = raw.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fence) s = fence[1]
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start >= 0 && end > start) s = s.slice(start, end + 1)
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

// Базовая валидация выжимки: без title/summary_text ответ моделями не считаем.
function isValidSummary(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.title === 'string' && o.title.trim().length > 0 &&
    typeof o.summary_text === 'string' && o.summary_text.trim().length > 0
}

// ===== Транскрибация: Gemini 3.5 Transcribe (REST generateContent) =====
// Референс — Voxel v2 (модели gemini-3.5-transcribe): аудио inline base64.
// Язык авто (ru/en/uz). Ретрай ×2 при 429 (rate-limit)/5xx/сетевых сбоях.
async function transcribeWithRetry(audioBytes: Uint8Array, mimeType: string): Promise<{ text: string | null; detail?: string }> {
  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) return { text: null, detail: 'no-gemini-key' }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-transcribe:generateContent?key=${key}`
  // Base64 собираем чанками: spread на многoмегабайтном файле уронит стек.
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < audioBytes.length; i += CHUNK) {
    binary += String.fromCharCode(...audioBytes.subarray(i, i + CHUNK))
  }
  const body = JSON.stringify({
    contents: [{
      parts: [
        { text: 'Транскрибируй аудио дословно, без пунктуационной цензуры и сокращений. Автоопределение языка.' },
        { inline_data: { mime_type: mimeType, data: btoa(binary) } },
      ],
    }],
  })

  let lastDetail = 'unknown'
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      // 5xx/таймаут — ретраим. 429 — тоже ретраим: это минутный лимит (RPM)
      // ключа, через ~20с отпускает. Без этого запись пользователя падала бы
      // навсегда при любом попадании в rate-limit.
      if (res.status === 429 || res.status >= 500) {
        lastDetail = `gemini http ${res.status}`
        if (attempt < 2) await new Promise((r) => setTimeout(r, 20_000))
        continue
      }
      if (!res.ok) return { text: null, detail: `gemini http ${res.status}: ${(await res.text()).slice(0, 200)}` }
      const json = await res.json()
      const parts = json?.candidates?.[0]?.content?.parts
      let text = ''
      if (Array.isArray(parts)) {
        for (const part of parts) {
          // REST отдаёт поле в camelCase: audioTranscription.text
          const t = part?.text ?? part?.audioTranscription?.text ?? part?.audio_transcription?.text
          if (typeof t === 'string') text += (text ? ' ' : '') + t
        }
      }
      text = text.trim()
      if (text) return { text }
      lastDetail = 'empty transcript'
    } catch (e) {
      lastDetail = String(e)
    }
  }
  return { text: null, detail: lastDetail }
}

// Проверяет JWT и возвращает id пользователя (или null).
async function authUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return null
  const token = auth.slice(7).trim()
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  if (!supabaseUrl || !token) return null
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      },
    })
    if (!res.ok) return null
    const user = await res.json()
    return typeof user?.id === 'string' ? user.id : null
  } catch {
    return null
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reply({ error: 'use-post' }, 405)

  const userId = await authUserId(req)
  if (!userId) return reply({ error: 'unauthorized' }, 401)

  try {
    const body = await req.json().catch(() => ({}))
    const op = typeof body?.op === 'string' ? body.op : ''

    // ===== op: transcribe — аудио из бакета -> Gemini -> транскрипт =====
    if (op === 'transcribe') {
      const audioPath = typeof body?.audioPath === 'string' ? body.audioPath.trim() : ''
      if (!audioPath) return reply({ error: 'no-audio-path' }, 400)
      // Чужое аудио читать нельзя: путь обязан лежать в папке пользователя.
      if (!audioPath.startsWith(`${userId}/`)) return reply({ error: 'forbidden-path' }, 403)

      const supabaseUrl = Deno.env.get('SUPABASE_URL')
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      if (!supabaseUrl || !serviceKey) return reply({ error: 'no-service-config' })

      // Скачиваем аудио с JWT владельца (RLS-политика «own diary-audio read»):
      // из edge-сети сервисный ключ до storage не доходит, а JWT владельца
      // проходит по политике бакета. JWT уже проверен в authUserId.
      const authHeader = req.headers.get('Authorization') ?? ''
      const res = await fetch(
        `${supabaseUrl}/storage/v1/object/diary-audio/${audioPath}`,
        { headers: { Authorization: authHeader } },
      )
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return reply({ error: 'audio-not-found', detail: `storage http ${res.status}: ${body.slice(0, 200)}` })
      }
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (bytes.length === 0) return reply({ error: 'audio-empty' })
      // Inline-лимит Gemini 20 MB: записи дневника (минуты речи) укладываются
      // с запасом, но мусорные большие файлы отсекаем сразу.
      if (bytes.length > 19 * 1024 * 1024) return reply({ error: 'audio-too-large' })

      const mimeType = audioPath.endsWith('.mp4') || audioPath.endsWith('.m4a')
        ? 'audio/mp4'
        : 'audio/webm'

      const r = await transcribeWithRetry(bytes, mimeType)
      if (!r.text) return reply({ error: 'transcribe-failed', detail: r.detail })
      return reply({ transcript: r.text })
    }

    // ===== op: summarize — текст + активные эксперименты -> JSON выжимки =====
    if (op === 'summarize') {
      const text = typeof body?.text === 'string' ? body.text.trim() : ''
      if (!text) return reply({ error: 'no-text' }, 400)
      const experiments = Array.isArray(body?.activeExperiments) ? body.activeExperiments : []
      const expJson = JSON.stringify(experiments)

      const messages = [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT.replace('{active_experiments_json}', expJson) },
        { role: 'user', content: text },
      ]

      const providers = buildSummarizeProviders()
      if (providers.length === 0) return reply({ error: 'no-api-key' })

      const details: string[] = []
      for (const p of providers) {
        // Попытка 1; при невалидном JSON — попытка 2 с напоминанием «только JSON».
        let raw: string | null = null
        const retryMessages = [...messages]
        for (let attempt = 0; attempt < 2; attempt++) {
          const r = await callChat(p, retryMessages, 1400)
          if (!r.text) {
            if (r.detail) details.push(r.detail)
            break
          }
          const parsed = extractJson(r.text)
          if (isValidSummary(parsed)) return reply({ summary: parsed, provider: p.name, model: p.model })
          details.push(`${p.model}: invalid json (attempt ${attempt + 1})`)
          if (attempt === 0) {
            retryMessages.push({ role: 'assistant', content: r.text })
            retryMessages.push({ role: 'user', content: 'Верни только валидный JSON без текста и без бэктиков.' })
          }
        }
      }

      return reply({ error: 'summarize-failed', detail: details.join(' | ').slice(0, 500) })
    }

    return reply({ error: 'unknown-op' }, 400)
  } catch (e) {
    return reply({ error: 'server', detail: String(e) })
  }
})

// Supabase Edge Function: diary-ai
// AI-бэкенд модуля «Дневник» (сознательно отделён от ai-chat: свой промпт,
// свои провайдеры, ноль влияния на AI-бухгалтера FinLit).
//
// Операции (POST JSON, поле op):
//   op: "drive-upload" { fileName, mime, dataBase64 } -> { fileId }  (v0.1.64+)
//     Серверный фолбэк: клиент не смог загрузить аудио в Drive напрямую —
//     шлёт клип сюда, сервер льёт в Drive по OAuth-ключам пользователя.
//   op: "transcribe" { driveFileId }          -> { transcript }   (v0.1.62+)
//   op: "transcribe" { audioPath }            -> { transcript }   (легаси до v0.1.62)
//     Аудио скачивается из Google Drive по OAuth-ключам пользователя из
//     app_settings (driveFileId) либо из приватного бакета diary-audio
//     (легаси-путь {user_id}/...), и отправляется в Gemini 3.5 Transcribe
//     (аудио inline base64).
//   op: "summarize"  { text, activeExperiments } -> { summary }
//     Выжимка записи через LLM. Основной провайдер: Groq, модель
//     openai/gpt-oss-120b (секрет GROQ_API_KEY). Fallback: NVIDIA NIM,
//     meta/llama-3.3-70b-instruct (секрет NVIDIA_API_KEY).
//
// Аутентификация: Supabase JWT пользователя в Authorization header. Для
// легаси-transcribe дополнительно проверяется, что audioPath лежит внутри
// папки {user_id}/ — чужое аудио прочитать нельзя; в Drive-ветке читается
// только то, что доступно токену самого пользователя (scope drive.file).
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
// ВАЖНО: этот промпт продублирован на клиенте — src/lib/diaryDefaults.ts
// (DEFAULT_SUMMARY_PROMPT). Экран настроек дневника показывает его в поле,
// пока пользователь не задал свой оверрайд в app_settings. Правишь здесь —
// синхронно правь там (и наоборот), чтобы поле показывало реальность.
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

// Ключ пользователя имеет приоритет над серверным секретом (настройки дневника).
function buildSummarizeProviders(userGroqKey: string | null = null): LlmProvider[] {
  const providers: LlmProvider[] = []
  const groqKey = userGroqKey || Deno.env.get('GROQ_API_KEY')
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

// ===== Настройки дневника конкретного пользователя =====
// Хранятся в app_settings (синхронизируются между устройствами). Запрос идёт
// с JWT самого пользователя — RLS «own app_settings» пускает только свою строку.
// Любая ошибка = мягкая деградация до серверных дефолтов.
type DiarySettings = {
  smartTranscription: boolean
  summaryPrompt: string | null
  geminiKey: string | null
  groqKey: string | null
  // OAuth Google Drive (хранилище аудио дневника, v0.1.62+).
  driveClientId: string | null
  driveClientSecret: string | null
  driveRefreshToken: string | null
  // Канонические фразы из словаря Voxel (push через diary-dictionary).
  vocabulary: string[]
}

const DEFAULT_SETTINGS: DiarySettings = {
  smartTranscription: true,
  summaryPrompt: null,
  geminiKey: null,
  groqKey: null,
  driveClientId: null,
  driveClientSecret: null,
  driveRefreshToken: null,
  vocabulary: [],
}

async function loadDiarySettings(req: Request, userId: string): Promise<DiarySettings> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!supabaseUrl || !anonKey || !authHeader) return { ...DEFAULT_SETTINGS }
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/app_settings?user_id=eq.${userId}&select=diary_smart_transcription,diary_summary_prompt,diary_gemini_key,diary_groq_key,diary_drive_client_id,diary_drive_client_secret,diary_drive_refresh_token,diary_vocabulary`,
      { headers: { Authorization: authHeader, apikey: anonKey } },
    )
    if (!res.ok) return { ...DEFAULT_SETTINGS }
    const rows = await res.json()
    const r = Array.isArray(rows) ? rows[0] : undefined
    if (!r) return { ...DEFAULT_SETTINGS }
    const trim = (v: unknown): string | null =>
      typeof v === 'string' && v.trim() ? v.trim() : null
    return {
      smartTranscription: r.diary_smart_transcription !== false,
      summaryPrompt: trim(r.diary_summary_prompt),
      geminiKey: trim(r.diary_gemini_key),
      groqKey: trim(r.diary_groq_key),
      driveClientId: trim(r.diary_drive_client_id),
      driveClientSecret: trim(r.diary_drive_client_secret),
      driveRefreshToken: trim(r.diary_drive_refresh_token),
      vocabulary: Array.isArray(r.diary_vocabulary) ? r.diary_vocabulary.filter((p: unknown): p is string => typeof p === 'string') : [],
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

// ===== Google Drive: access token по refresh token пользователя =====

async function driveAccessToken(s: DiarySettings): Promise<string | null> {
  if (!s.driveClientId || !s.driveClientSecret || !s.driveRefreshToken) return null
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: s.driveClientId,
        client_secret: s.driveClientSecret,
        refresh_token: s.driveRefreshToken,
        grant_type: 'refresh_token',
      }),
    })
    if (!res.ok) return null
    const json = await res.json()
    return typeof json?.access_token === 'string' ? json.access_token : null
  } catch {
    return null
  }
}

// Ищет папку по имени (среди файлов приложения), иначе создаёт. Цепочка
// Nucleus/DiaryAudio/YYYY/MM — та же, что строит клиент в drive.ts.
async function driveEnsureFolder(token: string, name: string, parent: string | null): Promise<string> {
  const clauses = [
    `name = ${JSON.stringify(name)}`,
    "mimeType = 'application/vnd.google-apps.folder'",
    'trashed = false',
    // В корне ищем строго через 'root' in parents ('me' in parents даёт 404).
    parent ? `'${parent}' in parents` : "'root' in parents",
  ]
  const list = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(clauses.join(' and '))}&fields=files(id)&pageSize=5`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (list.ok) {
    const j = await list.json()
    if (Array.isArray(j?.files) && j.files[0]?.id) return j.files[0].id as string
  }
  const created = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parent ? { parents: [parent] } : {}) }),
  })
  if (!created.ok) throw new Error(`drive-mkdir-failed http ${created.status}`)
  const cj = await created.json()
  if (!cj?.id) throw new Error('drive-mkdir-failed no id')
  return cj.id as string
}

// ===== Транскрибация: Gemini 3.5 Transcribe (REST generateContent) =====
// Референс — Voxel v2 (модели gemini-3.5-transcribe): аудио inline base64,
// конфиг транскрипции через generationConfig.audioTranscriptionConfig.
// mode: SMART — умное форматирование (тиражи/числа, удаление запинок),
//       VERBATIM — дословно. Язык авто (ru/en/uz). Ретрай ×2 при 429/5xx.
// Biasing распознавания: канонические фразы словаря Voxel. Тот же фильтр, что
// в Voxel v2 build_gemini_custom_vocabulary: короткие токены не бист ничего,
// запятая/перевод строки — список вариантов, а не фраза. Лимит API — 1000 фраз.
function cleanVocabulary(vocabulary: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of vocabulary) {
    const p = (raw ?? '').trim()
    if (p.length < 2 || p.includes(',') || p.includes('\n')) continue
    const key = p.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
    if (out.length >= 1000) break
  }
  return out
}

async function transcribeWithRetry(
  audioBytes: Uint8Array,
  mimeType: string,
  smartMode: boolean,
  geminiKey: string | null,
  vocabulary: string[],
): Promise<{ text: string | null; detail?: string }> {
  const key = geminiKey || Deno.env.get('GEMINI_API_KEY')
  if (!key) return { text: null, detail: 'no-gemini-key' }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-transcribe:generateContent?key=${key}`
  // Base64 собираем чанками: spread на многoмегабайтном файле уронит стек.
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < audioBytes.length; i += CHUNK) {
    binary += String.fromCharCode(...audioBytes.subarray(i, i + CHUNK))
  }
  const transcriptionConfig: Record<string, unknown> = {
    mode: smartMode ? 'SMART' : 'VERBATIM',
    languageCodes: ['ru', 'en', 'uz'],
  }
  const vocab = cleanVocabulary(vocabulary)
  if (vocab.length > 0) transcriptionConfig.customVocabulary = vocab
  const body = JSON.stringify({
    contents: [{
      parts: [{ inline_data: { mime_type: mimeType, data: btoa(binary) } }],
    }],
    generationConfig: { audioTranscriptionConfig: transcriptionConfig },
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
    const settings = await loadDiarySettings(req, userId)

    // ===== op: drive-upload — серверный фолбэк загрузки аудио в Drive =====
    // Клиент иногда не может достучаться до googleapis из WebView («Failed to
    // fetch») — тогда он шлёт клип сюда (base64), а сервер льёт его в Drive
    // по ключам самого пользователя. Канал Supabase работает всегда.
    if (op === 'drive-upload') {
      const fileName = typeof body?.fileName === 'string' ? body.fileName.trim() : ''
      const b64 = typeof body?.dataBase64 === 'string' ? body.dataBase64 : ''
      if (!fileName || !b64) return reply({ error: 'no-file' })
      // Имя строго формата клиента: YYYY-MM-DD-HHMMSS.ext — произвольные пути запрещены.
      if (!/^\d{4}-\d{2}-\d{2}-\d{6}\.(webm|m4a)$/.test(fileName)) return reply({ error: 'bad-file-name' }, 400)

      const token = await driveAccessToken(settings)
      if (!token) return reply({ error: 'no-drive-config' })

      try {
        const [y, m] = fileName.split('-')
        let parent: string | null = null
        for (const seg of ['Nucleus', 'DiaryAudio', y, m]) {
          parent = await driveEnsureFolder(token, seg, parent)
        }

        const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
        if (bin.length === 0) return reply({ error: 'audio-empty' })
        if (bin.length > 19 * 1024 * 1024) return reply({ error: 'audio-too-large' })

        const mime = fileName.endsWith('.m4a') ? 'audio/mp4' : 'audio/webm'
        const enc = new TextEncoder()
        const boundary = 'edge' + crypto.randomUUID().replace(/-/g, '')
        const head = enc.encode(
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: fileName, parents: [parent] })}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
        )
        const foot = enc.encode(`\r\n--${boundary}--\r\n`)
        const parts = new Uint8Array(head.length + bin.length + foot.length)
        parts.set(head, 0)
        parts.set(bin, head.length)
        parts.set(foot, head.length + bin.length)

        const up = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body: parts,
        })
        if (!up.ok) {
          const errBody = await up.text().catch(() => '')
          return reply({ error: 'drive-upload-failed', detail: `drive http ${up.status}: ${errBody.slice(0, 200)}` })
        }
        const upJson = await up.json()
        if (!upJson?.id) return reply({ error: 'drive-upload-failed', detail: 'no id' })
        // «Всем по ссылке» — как при прямой загрузке, иначе Obsidian не проиграет.
        await fetch(`https://www.googleapis.com/drive/v3/files/${upJson.id}/permissions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'reader', type: 'anyone' }),
        })
        return reply({ fileId: upJson.id })
      } catch (e) {
        return reply({ error: 'drive-upload-failed', detail: String(e).slice(0, 300) })
      }
    }

    // ===== op: transcribe — аудио из Drive (или легаси-бакета) -> Gemini =====
    if (op === 'transcribe') {
      const driveFileId = typeof body?.driveFileId === 'string' ? body.driveFileId.trim() : ''
      const audioPath = typeof body?.audioPath === 'string' ? body.audioPath.trim() : ''

      let bytes: Uint8Array
      let mimeType: string
      if (driveFileId) {
        // v0.1.62+: аудио в Google Drive. Скачиваем по access token самого
        // пользователя (ключи из его app_settings, scope drive.file) — чужие
        // файлы его токен прочитать не даст.
        const token = await driveAccessToken(settings)
        if (!token) return reply({ error: 'no-drive-config' })
        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?alt=media`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
        if (!res.ok) {
          const errBody = await res.text().catch(() => '')
          return reply({ error: 'audio-not-found', detail: `drive http ${res.status}: ${errBody.slice(0, 200)}` })
        }
        bytes = new Uint8Array(await res.arrayBuffer())
        // Нормализуем: Gemini ждёт простой mime без codecs.
        mimeType = typeof body?.mime === 'string' && body.mime.includes('mp4') ? 'audio/mp4' : 'audio/webm'
      } else {
        if (!audioPath) return reply({ error: 'no-audio-path' }, 400)
        // Легаси: чужое аудио читать нельзя — путь обязан лежать в папке пользователя.
        if (!audioPath.startsWith(`${userId}/`)) return reply({ error: 'forbidden-path' }, 403)

        const supabaseUrl = Deno.env.get('SUPABASE_URL')
        if (!supabaseUrl) return reply({ error: 'no-service-config' })

        // Скачиваем аудио с JWT владельца (RLS-политика «own diary-audio read»):
        // из edge-сети сервисный ключ до storage не доходит, а JWT владельца
        // проходит по политике бакета. JWT уже проверен в authUserId.
        const authHeader = req.headers.get('Authorization') ?? ''
        const res = await fetch(
          `${supabaseUrl}/storage/v1/object/diary-audio/${audioPath}`,
          { headers: { Authorization: authHeader } },
        )
        if (!res.ok) {
          const errBody = await res.text().catch(() => '')
          return reply({ error: 'audio-not-found', detail: `storage http ${res.status}: ${errBody.slice(0, 200)}` })
        }
        bytes = new Uint8Array(await res.arrayBuffer())
        mimeType = audioPath.endsWith('.mp4') || audioPath.endsWith('.m4a')
          ? 'audio/mp4'
          : 'audio/webm'
      }

      if (bytes.length === 0) return reply({ error: 'audio-empty' })
      // Inline-лимит Gemini 20 MB: записи дневника (минуты речи) укладываются
      // с запасом, но мусорные большие файлы отсекаем сразу.
      if (bytes.length > 19 * 1024 * 1024) return reply({ error: 'audio-too-large' })

      const r = await transcribeWithRetry(bytes, mimeType, settings.smartTranscription, settings.geminiKey, settings.vocabulary)
      if (!r.text) return reply({ error: 'transcribe-failed', detail: r.detail })
      return reply({ transcript: r.text, mode: settings.smartTranscription ? 'SMART' : 'VERBATIM' })
    }

    // ===== op: summarize — текст + активные эксперименты -> JSON выжимки =====
    if (op === 'summarize') {
      const text = typeof body?.text === 'string' ? body.text.trim() : ''
      if (!text) return reply({ error: 'no-text' }, 400)
      const experiments = Array.isArray(body?.activeExperiments) ? body.activeExperiments : []
      const expJson = JSON.stringify(experiments)

      // Кастомный промпт пользователя (если задан) полностью заменяет системный;
      // плейсхолдер {active_experiments_json} обязателен — если его нет,
      // подсписок экспериментов добавляем в конец, иначе AI не увидит активные
      // челленджи и не сможет отследить их прогресс.
      let systemPrompt = settings.summaryPrompt || SUMMARY_SYSTEM_PROMPT
      if (systemPrompt.includes('{active_experiments_json}')) {
        systemPrompt = systemPrompt.replace('{active_experiments_json}', expJson)
      } else {
        systemPrompt = `${systemPrompt}\n\nСПИСОК АКТИВНЫХ ЭКСПЕРИМЕНТОВ (может быть пустым):\n${expJson}`
      }

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ]

      const providers = buildSummarizeProviders(settings.groqKey)
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

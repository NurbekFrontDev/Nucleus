// Supabase Edge Function: ai-chat
// Единая точка общения с ИИ-ассистентом «FinLit Бухгалтер».
// Принимает историю сообщений и необязательный системный промпт, на сервере
// ходит к провайдеру ИИ (ключ спрятан в секретах Supabase) и возвращает ответ.
//
// Провайдер: NVIDIA NIM (OpenAI-совместимый), ключ NVIDIA_API_KEY.
// Модели — список через запятую в NVIDIA_MODEL (перебираем по очереди: если
// первая модель недоступна/устарела — пробуем следующую). Так можно менять
// модель/базовый URL без правки кода — через секреты.
//
// Тело запроса (POST, JSON):
//   { messages: [{ role, content }], system?: string, temperature?: number, max_tokens?: number }
// Ответ: { reply, provider, model } либо { error, detail? }.
// Обработанные ошибки возвращаем со статусом 200 и полем error/detail, чтобы
// клиент мог показать причину, а не общее «network».

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

function reply(obj: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

type ChatRole = 'system' | 'user' | 'assistant'
type ChatMessage = { role: ChatRole; content: string }

// Модели по умолчанию (перебор по очереди). Можно переопределить секретом
// NVIDIA_MODEL (через запятую). Если основная модель устарела — сработает запасная.
const DEFAULT_MODELS = [
  'z-ai/glm-5.2',
  'meta/llama-3.3-70b-instruct',
  'meta/llama-3.1-70b-instruct',
]

// Один вызов к OpenAI-совместимому /chat/completions для конкретной модели.
// Возвращает текст либо detail с причиной неудачи (для диагностики).
async function callModel(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number,
): Promise<{ text: string | null; detail?: string }> {
  try {
    const res = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
        // Отключаем режим «раздумывания» (thinking/reasoning) у моделей, которые
        // его поддерживают (GLM и т.п.). Приложение простое, долгие раздумья не
        // нужны, особенно на короткие сообщения вроде «привет». Модели без этой
        // опции просто игнорируют неизвестное поле.
        chat_template_kwargs: { enable_thinking: false },
      }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { text: null, detail: `HTTP ${res.status} (${model}): ${t.slice(0, 200)}` }
    }
    const json = await res.json()
    const text = json?.choices?.[0]?.message?.content
    if (typeof text === 'string' && text.trim().length > 0) return { text }
    return { text: null, detail: `empty completion (${model})` }
  } catch (e) {
    return { text: null, detail: `${model}: ${String(e)}` }
  }
}

// Приводим входящие сообщения к безопасному виду: только нужные роли и текст.
function normalizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return []
  const out: ChatMessage[] = []
  for (const m of raw) {
    const role =
      m?.role === 'system' || m?.role === 'assistant' || m?.role === 'user'
        ? (m.role as ChatRole)
        : null
    const content = typeof m?.content === 'string' ? m.content : null
    if (role && content && content.trim().length > 0) {
      out.push({ role, content })
    }
  }
  return out
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reply({ error: 'use-post' }, 405)

  try {
    const body = await req.json().catch(() => ({}))

    let messages = normalizeMessages(body?.messages)
    const system = typeof body?.system === 'string' ? body.system.trim() : ''
    const temperature = Number.isFinite(body?.temperature) ? Number(body.temperature) : 0.4
    // Меньше max_tokens -> модели физически нечего генерировать после ответа,
    // поэтому ответ приходит быстрее. Ассистент и так просят отвечать коротко
    // (см. SOUL), 600 токенов с запасом хватает на обычный ответ и разбор покупки.
    const maxTokens = Number.isFinite(body?.max_tokens) ? Number(body.max_tokens) : 600

    if (system && messages[0]?.role !== 'system') {
      messages = [{ role: 'system', content: system }, ...messages]
    }
    if (messages.length === 0) return reply({ error: 'no-messages' }, 400)

    const apiKey = Deno.env.get('NVIDIA_API_KEY')
    if (!apiKey) return reply({ error: 'no-api-key' })

    const baseUrl = Deno.env.get('NVIDIA_BASE_URL') ?? 'https://integrate.api.nvidia.com/v1'
    const modelEnv = Deno.env.get('NVIDIA_MODEL') ?? ''
    const models = modelEnv
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    const list = models.length > 0 ? models : DEFAULT_MODELS

    const details: string[] = []
    for (const model of list) {
      const r = await callModel(baseUrl, apiKey, model, messages, temperature, maxTokens)
      if (r.text) return reply({ reply: r.text, provider: 'nvidia', model })
      if (r.detail) details.push(r.detail)
    }

    // Все модели не ответили — возвращаем причину (статус 200, чтобы клиент её показал).
    return reply({ error: 'ai-unavailable', detail: details.join(' | ').slice(0, 500) })
  } catch (e) {
    return reply({ error: 'server', detail: String(e) })
  }
})

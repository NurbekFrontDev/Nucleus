// Supabase Edge Function: ai-chat
// Единая точка общения с ИИ-ассистентом «FinLit Бухгалтер».
// Принимает историю сообщений и необязательный системный промпт, на сервере
// ходит к провайдеру ИИ (ключ спрятан в секретах Supabase) и возвращает ответ.
// Браузер ключ никогда не видит, как и в функции get-rate.
//
// Провайдер: GLM 5.1 (NVIDIA NIM, бесплатно), ключ NVIDIA_API_KEY. Grok и DeepSeek
// убраны по просьбе пользователя (DeepSeek используется в другом месте отдельно).
// OpenAI-совместимый эндпоинт, поэтому смену модели/базового URL можно сделать
// без правки кода - через секреты NVIDIA_BASE_URL / NVIDIA_MODEL.
//
// Тело запроса (POST, JSON):
//   { messages: [{ role, content }], system?: string,
//     temperature?: number, max_tokens?: number }
// Ответ: { reply: string, provider: 'nvidia', model: string }
//        либо { error: string } со статусом 4xx/5xx.

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

type Provider = {
  name: 'nvidia'
  baseUrl: string
  apiKey: string | undefined
  model: string
}

// Один вызов к OpenAI-совместимому эндпоинту /chat/completions.
// Возвращает текст ответа или null, если провайдер недоступен либо ответ пустой.
async function callProvider(
  p: Provider,
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number,
): Promise<string | null> {
  if (!p.apiKey) return null
  try {
    const res = await fetch(p.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + p.apiKey,
      },
      body: JSON.stringify({
        model: p.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      }),
    })
    if (!res.ok) return null
    const json = await res.json()
    const text = json?.choices?.[0]?.message?.content
    return typeof text === 'string' && text.trim().length > 0 ? text : null
  } catch {
    return null
  }
}

// Приводим входящие сообщения к безопасному виду: только нужные роли и строковый текст.
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
    const maxTokens = Number.isFinite(body?.max_tokens) ? Number(body.max_tokens) : 1024

    // Если передан системный промпт и его ещё нет в начале истории, добавляем сверху.
    if (system && messages[0]?.role !== 'system') {
      messages = [{ role: 'system', content: system }, ...messages]
    }

    if (messages.length === 0) return reply({ error: 'no-messages' }, 400)

    const providers: Provider[] = [
      {
        name: 'nvidia',
        baseUrl: Deno.env.get('NVIDIA_BASE_URL') ?? 'https://integrate.api.nvidia.com/v1',
        apiKey: Deno.env.get('NVIDIA_API_KEY'),
        model: Deno.env.get('NVIDIA_MODEL') ?? 'z-ai/glm-5.1',
      },
    ]

    if (!providers.some((p) => p.apiKey)) {
      return reply({ error: 'no-api-key' }, 500)
    }

    for (const p of providers) {
      const text = await callProvider(p, messages, temperature, maxTokens)
      if (text) return reply({ reply: text, provider: p.name, model: p.model })
    }

    return reply({ error: 'ai-unavailable' }, 502)
  } catch (e) {
    return reply({ error: String(e) }, 500)
  }
})

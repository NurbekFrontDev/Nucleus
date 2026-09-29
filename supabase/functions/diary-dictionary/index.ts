// Приёмник словаря Voxel (Ф3): Voxel при каждом изменении словаря пушит полный
// список канонических фраз, функция кладёт его в app_settings.diary_vocabulary
// администратора. Оттуда diary-ai подставляет фразы в Gemini customVocabulary,
// а Realtime раздаёт их на все устройства Nucleus.
//
// Авторизация: заголовок x-dict-key должен совпадать с секретом DICT_PUSH_SECRET
// (задаётся через `supabase secrets set`). Voxel хранит этот же секрет в своём
// локальном конфиге. Пользователь-администратор ищется по email через admin API.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dict-key',
}

function reply(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const ADMIN_EMAIL = 'dlaprogrammirovanieidlaameriki@gmail.com'
// Тот же фильтр, что в Voxel build_gemini_custom_vocabulary.
const MAX_PHRASES = 1000

function cleanVocabulary(raw: unknown): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  if (!Array.isArray(raw)) return out
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const p = item.trim()
    if (p.length < 2 || p.includes(',') || p.includes('\n')) continue
    const key = p.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
    if (out.length >= MAX_PHRASES) break
  }
  return out
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reply({ error: 'use-post' }, 405)

  // Секретный ключ push-канала: сравнение через constTimeEqual-подобный обход,
  // чтобы не отдавать таймингом длину секрета.
  const secret = Deno.env.get('DICT_PUSH_SECRET')
  const provided = req.headers.get('x-dict-key') ?? ''
  if (!secret || provided.length !== secret.length || provided !== secret) {
    return reply({ error: 'unauthorized' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return reply({ error: 'no-service-config' }, 500)

  let body: { vocabulary?: unknown }
  try {
    body = await req.json()
  } catch {
    return reply({ error: 'bad-json' }, 400)
  }
  const vocabulary = cleanVocabulary(body.vocabulary)

  // Ищем администратора по email (личный проект, пользователей единицы).
  const adminRes = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=200`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  })
  if (!adminRes.ok) return reply({ error: 'admin-lookup-failed', detail: `http ${adminRes.status}` }, 500)
  const usersJson = await adminRes.json()
  const users = Array.isArray(usersJson?.users) ? usersJson.users : []
  const admin = users.find((u: { email?: string }) => u.email?.toLowerCase() === ADMIN_EMAIL)
  if (!admin?.id) return reply({ error: 'admin-not-found' }, 500)

  // Upsert только словарной колонки: merge-duplicates не трогает остальные поля.
  const upsertRes = await fetch(`${supabaseUrl}/rest/v1/app_settings`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([{ user_id: admin.id, diary_vocabulary: vocabulary }]),
  })
  if (!upsertRes.ok) {
    const detail = await upsertRes.text().catch(() => '')
    return reply({ error: 'upsert-failed', detail: detail.slice(0, 200) }, 500)
  }
  return reply({ ok: true, count: vocabulary.length })
})

// Supabase Edge Function — отправка push через FCM HTTP v1 (этап А-7, шаг 6).
//
// Принимает POST { userId, title, body?, route? }, находит все FCM-токены
// пользователя в таблице push_tokens и шлёт им уведомление.
//
// Секреты функции (supabase secrets set ...):
//   FCM_SERVICE_ACCOUNT   — весь JSON сервисного аккаунта Firebase (одной строкой)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — подставляются автоматически.
//
// Деплой: supabase functions deploy send-push

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'

type ServiceAccount = {
  client_email: string
  private_key: string
  project_id: string
  token_uri: string
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}

function base64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Получаем OAuth2 access token для FCM через подписанный JWT сервисного аккаунта.
async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claim = {
    iss: sa.client_email,
    scope: FCM_SCOPE,
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  }
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)),
  )
  const jwt = `${unsigned}.${base64url(sig)}`
  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`Не удалось получить токен доступа: ${JSON.stringify(json)}`)
  return json.access_token as string
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }
    const { userId, title, body, route } = await req.json()
    if (!userId || !title) {
      return new Response(JSON.stringify({ error: 'userId и title обязательны' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const sa = JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT') ?? '{}') as ServiceAccount
    if (!sa.client_email) {
      return new Response(JSON.stringify({ error: 'Секрет FCM_SERVICE_ACCOUNT не задан' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: tokens, error } = await supabase
      .from('push_tokens')
      .select('token')
      .eq('user_id', userId)
    if (error) throw error
    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ sent: 0, note: 'нет токенов' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const accessToken = await getAccessToken(sa)
    const endpoint = 'https://fcm.googleapis.com/v1/projects/' + sa.project_id + '/messages:send'
    let sent = 0
    const invalid: string[] = []
    for (const { token } of tokens as { token: string }[]) {
      const message = {
        message: {
          token,
          notification: { title, body: body ?? '' },
          data: route ? { route: String(route) } : {},
          android: { priority: 'HIGH' },
        },
      }
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      })
      if (r.ok) {
        sent++
      } else if (r.status === 404 || r.status === 400) {
        // Токен устарел/недействителен — помечаем на удаление.
        invalid.push(token)
      }
    }
    if (invalid.length > 0) {
      await supabase.from('push_tokens').delete().in('token', invalid)
    }
    return new Response(JSON.stringify({ sent, removed: invalid.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

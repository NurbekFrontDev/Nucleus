// Supabase Edge Function: diary-audio-stream
// Публичный стриминг-прокси аудио дневника из Google Drive.
//
// ЗАЧЕМ: Drive отдаёт файлы с Content-Type: application/octet-stream,
// X-Content-Type-Options: nosniff и Content-Disposition: attachment —
// Chromium (Obsidian/Electron и WebView Nucleus) отказывается проигрывать
// такое в <audio>: плеер показывает 0:00/0:00. Прокси отдаёт тот же файл
// с правильным audio/webm|mp4 и сохраняет Range-запросы (стриминг/перемотка).
//
// Публичный без JWT: сами файлы уже открыты «всем по ссылке» (unguessable
// fileId), прокси только чинит заголовки. Upstream жёстко ограничен
// drive.usercontent.google.com, fileId валидируется по формату.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'range, authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'GET') return new Response('use-get', { status: 405, headers: CORS })

  const url = new URL(req.url)
  const fileId = (url.searchParams.get('id') ?? '').trim()
  const ext = url.searchParams.get('ext') === 'm4a' ? 'mp4' : 'webm'
  if (!/^[A-Za-z0-9_-]{20,60}$/.test(fileId)) {
    return new Response(JSON.stringify({ error: 'bad-file-id' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // Range пробрасываем наверх — перемотка и стриминг работают как у Drive.
  const upstreamHeaders: Record<string, string> = {}
  const range = req.headers.get('range')
  if (range) upstreamHeaders['Range'] = range

  let up: Response
  try {
    up = await fetch(
      `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`,
      { headers: upstreamHeaders },
    )
  } catch {
    return new Response(JSON.stringify({ error: 'upstream-fetch' }), {
      status: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
  if (!up.ok && up.status !== 206) {
    return new Response(JSON.stringify({ error: 'upstream', status: up.status }), {
      status: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const out = new Headers({ ...CORS })
  out.set('Content-Type', ext === 'mp4' ? 'audio/mp4' : 'audio/webm')
  out.set('Accept-Ranges', 'bytes')
  out.set('Cache-Control', 'public, max-age=86400')
  const contentRange = up.headers.get('content-range')
  if (contentRange) out.set('Content-Range', contentRange)
  const contentLength = up.headers.get('content-length')
  if (contentLength) out.set('Content-Length', contentLength)

  return new Response(up.body, { status: up.status === 206 ? 206 : 200, headers: out })
})

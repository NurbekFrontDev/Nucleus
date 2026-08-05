// Офлайн-слой для Supabase REST: IndexedDB-кэш чтений и надёжная очередь изменений.
// Работает и в браузере, и в WebView Capacitor. localStorage-кэши отдельных экранов
// остаются быстрым первым уровнем, а этот модуль хранит полноценные ответы и очередь
// между перезапусками приложения.

type CachedResponse = {
  key: string
  status: number
  headers: Array<[string, string]>
  body: string
  updatedAt: number
}

type QueuedRequest = {
  id: string
  userId: string
  url: string
  method: string
  headers: Record<string, string>
  body: string | null
  createdAt: number
  optimisticId?: string
}

type IdMapping = {
  key: string
  userId: string
  temporaryId: string
  actualId: string
  updatedAt: number
}

type AuthHeadersProvider = () => Promise<Record<string, string>>
type StatusListener = () => void

export type OfflineStatus = {
  online: boolean
  pending: number
}

const DB_NAME = 'nucleus-offline'
const DB_VERSION = 1
const RESPONSE_STORE = 'responses'
const QUEUE_STORE = 'queue'
const MAPPING_STORE = 'mappings'

let dbPromise: Promise<IDBDatabase | null> | null = null
let activeUserId = 'anonymous'
let syncing = false
const listeners = new Set<StatusListener>()

// Fallback для редких браузеров, где IndexedDB временно недоступен.
const memoryResponses = new Map<string, CachedResponse>()
const memoryQueue = new Map<string, QueuedRequest>()
const memoryMappings = new Map<string, IdMapping>()

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(RESPONSE_STORE)) {
          db.createObjectStore(RESPONSE_STORE, { keyPath: 'key' })
        }
        if (!db.objectStoreNames.contains(QUEUE_STORE)) {
          db.createObjectStore(QUEUE_STORE, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(MAPPING_STORE)) {
          db.createObjectStore(MAPPING_STORE, { keyPath: 'key' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

async function getOne<T>(storeName: string, key: IDBValidKey): Promise<T | null> {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly')
      const request = tx.objectStore(storeName).get(key)
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null)
      request.onerror = () => resolve(null)
      tx.onabort = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function getAll<T>(storeName: string): Promise<T[] | null> {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly')
      const request = tx.objectStore(storeName).getAll()
      request.onsuccess = () => resolve(request.result as T[])
      request.onerror = () => resolve(null)
      tx.onabort = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function putOne(storeName: string, value: unknown): Promise<boolean> {
  const db = await openDb()
  if (!db) return false
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite')
      tx.objectStore(storeName).put(value)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
      tx.onabort = () => resolve(false)
    } catch {
      resolve(false)
    }
  })
}

async function deleteOne(storeName: string, key: IDBValidKey): Promise<boolean> {
  const db = await openDb()
  if (!db) return false
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite')
      tx.objectStore(storeName).delete(key)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
      tx.onabort = () => resolve(false)
    } catch {
      resolve(false)
    }
  })
}

function notifyStatus() {
  for (const listener of listeners) listener()
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

export function setOfflineUser(userId: string | null | undefined) {
  activeUserId = userId || 'anonymous'
  notifyStatus()
}

export function subscribeOfflineStatus(listener: StatusListener): () => void {
  listeners.add(listener)
  listener()
  return () => listeners.delete(listener)
}

export async function getOfflineStatus(): Promise<OfflineStatus> {
  const queue = await getQueuedRequests()
  return {
    online: isOnline(),
    pending: queue.filter((request) => request.userId === activeUserId).length,
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', notifyStatus)
  window.addEventListener('offline', notifyStatus)
}

function cacheKey(url: string): string {
  return `${activeUserId}|${url}`
}

async function saveCachedResponse(record: CachedResponse) {
  memoryResponses.set(record.key, record)
  await putOne(RESPONSE_STORE, record)
}

async function loadCachedResponse(key: string): Promise<CachedResponse | null> {
  const stored = await getOne<CachedResponse>(RESPONSE_STORE, key)
  return stored ?? memoryResponses.get(key) ?? null
}

async function saveQueuedRequest(request: QueuedRequest) {
  memoryQueue.set(request.id, request)
  await putOne(QUEUE_STORE, request)
}

async function getQueuedRequests(): Promise<QueuedRequest[]> {
  const stored = await getAll<QueuedRequest>(QUEUE_STORE)
  const source = stored ?? [...memoryQueue.values()]
  return [...source].sort((a, b) => a.createdAt - b.createdAt)
}

async function removeQueuedRequest(id: string) {
  memoryQueue.delete(id)
  await deleteOne(QUEUE_STORE, id)
}

function mappingKey(userId: string, temporaryId: string): string {
  return `${userId}|${temporaryId}`
}

async function saveIdMapping(mapping: IdMapping) {
  memoryMappings.set(mapping.key, mapping)
  await putOne(MAPPING_STORE, mapping)
}

async function getIdMappings(userId: string): Promise<Map<string, string>> {
  const stored = await getAll<IdMapping>(MAPPING_STORE)
  const source = stored ?? [...memoryMappings.values()]
  return new Map(
    source
      .filter((mapping) => mapping.userId === userId)
      .map((mapping) => [mapping.temporaryId, mapping.actualId]),
  )
}

function asHeaders(headers?: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {}
  new Headers(headers).forEach((value, name) => {
    result[name.toLowerCase()] = value
  })
  return result
}

async function bodyToText(body: BodyInit | null | undefined): Promise<string | null> {
  if (body == null) return null
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  if (body instanceof Blob) return body.text()
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body)
  if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body.buffer)
  return null
}

async function describeRequest(input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request ? input : null
  const url = request ? request.url : String(input)
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
  const headers = asHeaders(init?.headers ?? request?.headers)
  const body =
    init?.body !== undefined
      ? await bodyToText(init.body)
      : request
        ? await request.clone().text().catch(() => '')
        : null
  return { url, method, headers, body: body || null }
}

function isRestRequest(url: string): boolean {
  return url.includes('/rest/v1/') && !url.includes('/rest/v1/rpc/')
}

function isRead(method: string): boolean {
  return method === 'GET' || method === 'HEAD'
}

function isMutation(method: string): boolean {
  return method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE'
}

function newTemporaryId(): string {
  const random = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  return `offline:${random}`
}

function wantsRepresentation(headers: Record<string, string>): boolean {
  const prefer = headers.prefer?.toLowerCase() ?? ''
  const accept = headers.accept?.toLowerCase() ?? ''
  return prefer.includes('return=representation') || accept.includes('application/vnd.pgrst.object+json')
}

function parseJson(body: string | null): unknown {
  if (!body) return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    return null
  }
}

function addTemporaryId(value: unknown, temporaryId: string): unknown {
  if (Array.isArray(value)) return value.map((row) => addTemporaryId(row, temporaryId))
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>
    return 'id' in row ? row : { ...row, id: temporaryId }
  }
  return value
}

function makeOfflineError(): Response {
  return new Response(JSON.stringify({ message: 'Нет сети и локальной копии данных.' }), {
    status: 503,
    headers: { 'content-type': 'application/json' },
  })
}

async function cacheNetworkResponse(url: string, response: Response) {
  if (!response.ok) return
  try {
    const body = await response.clone().text()
    const headers: Array<[string, string]> = []
    response.headers.forEach((value, name) => headers.push([name, value]))
    await saveCachedResponse({
      key: cacheKey(url),
      status: response.status,
      headers,
      body,
      updatedAt: Date.now(),
    })
  } catch {
    // Кэш — только ускорение и офлайн-страховка, не мешаем рабочему запросу.
  }
}

async function cachedOrOffline(url: string): Promise<Response> {
  const cached = await loadCachedResponse(cacheKey(url))
  return cached
    ? new Response(cached.body, { status: cached.status, headers: cached.headers })
    : makeOfflineError()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function tableForUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname
    const marker = '/rest/v1/'
    const index = path.indexOf(marker)
    if (index < 0) return null
    const table = path.slice(index + marker.length).split('/')[0]
    return table ? decodeURIComponent(table) : null
  } catch {
    return null
  }
}

function matchesQueryFilters(row: Record<string, unknown>, url: string): boolean {
  try {
    const params = new URL(url).searchParams
    for (const [field, condition] of params) {
      // Технические параметры не являются фильтрами строки PostgREST.
      if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(field)) continue
      if (condition.startsWith('eq.') && String(row[field] ?? '') !== condition.slice(3)) {
        return false
      }
    }
  } catch {
    // Если URL нестандартный, сохраняем запись: исходный UI всё равно уже оптимистичный.
  }
  return true
}

// Обновляет подходящие сохранённые GET-ответы сразу, чтобы добавленная без сети
// запись была видна и после перезапуска приложения, ещё до синхронизации.
async function updateOptimisticCaches(method: string, requestUrl: string, payload: unknown) {
  const table = tableForUrl(requestUrl)
  if (!table) return
  const stored = await getAll<CachedResponse>(RESPONSE_STORE)
  const records = stored ?? [...memoryResponses.values()]
  const userPrefix = `${activeUserId}|`

  for (const record of records) {
    if (!record.key.startsWith(userPrefix)) continue
    const cachedUrl = record.key.slice(userPrefix.length)
    if (tableForUrl(cachedUrl) !== table) continue
    const current = parseJson(record.body)
    if (!Array.isArray(current)) continue

    let next = current
    if (method === 'POST') {
      const sourceRows = Array.isArray(payload) ? payload : [payload]
      const additions = sourceRows.filter(isRecord).filter((row) => matchesQueryFilters(row, cachedUrl))
      if (additions.length === 0) continue
      const existingIds = new Set(
        current.filter(isRecord).map((row) => String(row.id ?? '')),
      )
      next = [...additions.filter((row) => !existingIds.has(String(row.id ?? ''))), ...current]
    } else if (method === 'PATCH' || method === 'PUT') {
      if (!isRecord(payload)) continue
      let changed = false
      next = current.map((row) => {
        if (!isRecord(row) || !matchesQueryFilters(row, requestUrl)) return row
        changed = true
        return { ...row, ...payload }
      })
      if (!changed) continue
    } else if (method === 'DELETE') {
      const filtered = current.filter((row) => !isRecord(row) || !matchesQueryFilters(row, requestUrl))
      if (filtered.length === current.length) continue
      next = filtered
    } else {
      continue
    }

    await saveCachedResponse({ ...record, body: JSON.stringify(next), updatedAt: Date.now() })
  }
}

async function enqueueMutation(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | null,
): Promise<Response> {
  const safeHeaders = { ...headers }
  // Токен в очереди не храним. При синхронизации подставляется свежий токен сессии.
  delete safeHeaders.authorization
  delete safeHeaders.apikey

  const needsRow = method === 'POST' && wantsRepresentation(headers)
  const temporaryId = needsRow ? newTemporaryId() : undefined
  const request: QueuedRequest = {
    id: newTemporaryId(),
    userId: activeUserId,
    url,
    method,
    headers: safeHeaders,
    body,
    createdAt: Date.now(),
    optimisticId: temporaryId,
  }
  await saveQueuedRequest(request)
  notifyStatus()

  const source = parseJson(body)
  const optimistic = temporaryId ? addTemporaryId(source, temporaryId) : source
  await updateOptimisticCaches(method, url, optimistic)
  const hasBody = optimistic !== null
  return new Response(hasBody ? JSON.stringify(optimistic) : null, {
    status: method === 'POST' ? 201 : hasBody ? 200 : 204,
    headers: hasBody ? { 'content-type': 'application/json' } : undefined,
  })
}

/**
 * Fetch, который передаётся Supabase:
 * - успешные GET сохраняет в IndexedDB;
 * - без сети отдаёт последнюю локальную копию GET;
 * - POST/PATCH/DELETE без сети ставит в очередь и возвращает оптимистичный ответ.
 */
export async function offlineFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const details = await describeRequest(input, init)
  if (!isRestRequest(details.url)) return globalThis.fetch(input, init)

  if (isRead(details.method)) {
    if (!isOnline()) return cachedOrOffline(details.url)
    try {
      const response = await globalThis.fetch(input, init)
      if (details.method === 'GET') void cacheNetworkResponse(details.url, response)
      return response
    } catch {
      return cachedOrOffline(details.url)
    }
  }

  if (isMutation(details.method)) {
    if (!isOnline()) {
      return enqueueMutation(details.url, details.method, details.headers, details.body)
    }
    try {
      return await globalThis.fetch(input, init)
    } catch {
      // Например, связь пропала в момент сохранения. UI получает оптимистичный ответ,
      // а реальный запрос будет повторён, когда сеть вернётся.
      return enqueueMutation(details.url, details.method, details.headers, details.body)
    }
  }

  return globalThis.fetch(input, init)
}

function replaceTemporaryIds(value: string, mappings: Map<string, string>): string {
  let result = value
  for (const [temporaryId, actualId] of mappings) {
    if (result.includes(temporaryId)) result = result.split(temporaryId).join(actualId)
  }
  return result
}

function responseId(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    const row = Array.isArray(parsed) ? parsed[0] : parsed
    if (row && typeof row === 'object' && 'id' in row) {
      const id = (row as { id?: unknown }).id
      return typeof id === 'string' ? id : null
    }
  } catch {
    // Объект с id нужен только для связанного офлайн-создания.
  }
  return null
}

async function rewriteQueuedReferences(userId: string, temporaryId: string, actualId: string) {
  const requests = await getQueuedRequests()
  for (const request of requests) {
    if (request.userId !== userId) continue
    const nextUrl = request.url.split(temporaryId).join(actualId)
    const nextBody = request.body?.split(temporaryId).join(actualId) ?? null
    if (nextUrl !== request.url || nextBody !== request.body) {
      await saveQueuedRequest({ ...request, url: nextUrl, body: nextBody })
    }
  }

  // Меняем временный id и в ответах чтения, иначе после синхронизации офлайн-кэш
  // мог бы продолжать отдавать устаревшую временную запись.
  const cached = await getAll<CachedResponse>(RESPONSE_STORE)
  const records = cached ?? [...memoryResponses.values()]
  const prefix = `${userId}|`
  for (const record of records) {
    if (!record.key.startsWith(prefix) || !record.body.includes(temporaryId)) continue
    await saveCachedResponse({
      ...record,
      body: record.body.split(temporaryId).join(actualId),
      updatedAt: Date.now(),
    })
  }
}

/** Отправляет накопленные офлайн-изменения в исходном порядке. */
export async function flushOfflineQueue(userId: string, getAuthHeaders: AuthHeadersProvider): Promise<number> {
  if (!userId || !isOnline() || syncing) return 0
  syncing = true
  let completed = 0

  try {
    const mappings = await getIdMappings(userId)
    const requests = await getQueuedRequests()
    for (const request of requests) {
      if (request.userId !== userId) continue

      const authHeaders = await getAuthHeaders()
      const url = replaceTemporaryIds(request.url, mappings)
      const body = request.body ? replaceTemporaryIds(request.body, mappings) : null
      let response: Response
      try {
        response = await globalThis.fetch(url, {
          method: request.method,
          headers: { ...request.headers, ...authHeaders },
          body,
        })
      } catch {
        // Связь снова пропала: не теряем оставшуюся очередь.
        break
      }

      if (!response.ok) {
        // Не удаляем изменения при серверной ошибке: попробуем позже, не теряя данные.
        console.warn('[offline] очередь остановлена:', response.status, await response.clone().text())
        break
      }

      if (request.optimisticId) {
        const actualId = responseId(await response.clone().text())
        if (!actualId) {
          console.warn('[offline] сервер не вернул id для офлайн-созданной записи')
          break
        }
        mappings.set(request.optimisticId, actualId)
        await saveIdMapping({
          key: mappingKey(userId, request.optimisticId),
          userId,
          temporaryId: request.optimisticId,
          actualId,
          updatedAt: Date.now(),
        })
        await rewriteQueuedReferences(userId, request.optimisticId, actualId)
      }

      await removeQueuedRequest(request.id)
      completed += 1
    }
  } finally {
    syncing = false
    notifyStatus()
  }

  return completed
}

/** Подключает фоновую синхронизацию при появлении сети и сразу пробует отправить очередь. */
export function startOfflineSync(flush: () => Promise<unknown>): () => void {
  const sync = () => {
    void flush()
      .catch((error) => console.warn('[offline] синхронизация не выполнена:', error))
      .finally(notifyStatus)
  }
  if (typeof window !== 'undefined') window.addEventListener('online', sync)
  sync()
  return () => {
    if (typeof window !== 'undefined') window.removeEventListener('online', sync)
  }
}

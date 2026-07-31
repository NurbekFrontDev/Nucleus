// ====================================================================
// Один скрипт вместо всей ручной возни с релизом Windows-версии.
//
// Что делает по шагам:
//   1. поднимает версию в package.json и src-tauri/tauri.conf.json;
//   2. собирает установщик (npm run tauri build) с подписью обновления;
//   3. находит .exe и .sig в src-tauri/target/release/bundle/nsis;
//   4. ЛОКАЛЬНЫЙ режим  -> сразу тихо ставит новую версию на этот компьютер
//      и перезапускает Nucleus. Никакого бакета и ожидания окна обновления.
//   5. ОБЛАЧНЫЙ режим    -> генерирует latest.json из подписи и заливает
//      .exe + .sig + latest.json в бакет releases Supabase Storage.
//      Заходить на сайт руками больше не нужно.
//
// Запуск:
//   npm run release:local        сборка + локальная установка (самый быстрый путь)
//   npm run release              сборка + публикация обновления в бакет
//   npm run release:both         сборка + публикация + локальная установка
//
// Флаги:
//   --bump=patch|minor|major|none   как поднять версию (по умолчанию patch)
//   --notes="текст"                 описание обновления для окна и latest.json
//   --local                         поставить локально
//   --upload                        залить в бакет releases
//   --skip-build                    не пересобирать (использовать готовые файлы)
//
// Секреты берутся из окружения или из .env.local (в git не попадает):
//   TAURI_SIGNING_PRIVATE_KEY            приватный ключ подписи обновлений
//   TAURI_SIGNING_PRIVATE_KEY_PASSWORD   пароль к ключу
//   SUPABASE_URL                         адрес проекта Supabase
//   SUPABASE_SERVICE_ROLE_KEY            сервисный ключ (только для заливки)
// ====================================================================

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUCKET = 'releases'

// ---------- аргументы ----------
const args = process.argv.slice(2)
const hasFlag = (name) => args.includes(`--${name}`)
const getArg = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`))
  return found ? found.slice(name.length + 3) : fallback
}

const doLocal = hasFlag('local')
const doUpload = hasFlag('upload')
const skipBuild = hasFlag('skip-build')
const bump = getArg('bump', 'patch')
const notesArg = getArg('notes', '')

if (!doLocal && !doUpload) {
  console.error('Укажите --local и/или --upload. Пример: npm run release:local')
  process.exit(1)
}

// ---------- .env.local ----------
// Читаем секреты из файла, чтобы не вбивать их в терминал каждый раз.
function loadEnvFile(file) {
  const path = join(root, file)
  if (!existsSync(path)) return
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}
loadEnvFile('.env.local')
loadEnvFile('.env')

// ---------- версия ----------
const pkgPath = join(root, 'package.json')
const confPath = join(root, 'src-tauri', 'tauri.conf.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const conf = JSON.parse(readFileSync(confPath, 'utf8'))

function nextVersion(current, kind) {
  if (kind === 'none') return current
  const [major, minor, patch] = current.split('.').map((n) => Number(n) || 0)
  if (kind === 'major') return `${major + 1}.0.0`
  if (kind === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

const version = nextVersion(pkg.version, bump)
if (version !== pkg.version) {
  pkg.version = version
  conf.version = version
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
  writeFileSync(confPath, `${JSON.stringify(conf, null, 2)}\n`, 'utf8')
  console.log(`Версия поднята до ${version}`)
} else {
  console.log(`Версия остаётся ${version}`)
}

const notes = notesArg || `Обновление Nucleus ${version}`

// ---------- сборка ----------
const bundleDir = join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
const exeName = `Nucleus_${version}_x64-setup.exe`
const exePath = join(bundleDir, exeName)
const sigPath = `${exePath}.sig`

if (!skipBuild) {
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
    console.warn(
      'Внимание: TAURI_SIGNING_PRIVATE_KEY_PASSWORD не задан. Подпись обновления может не создаться.',
    )
  }
  console.log('Сборка установщика…')
  execFileSync('npm', ['run', 'tauri', 'build'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  })
}

if (!existsSync(exePath)) {
  console.error(`Не найден установщик: ${exePath}`)
  process.exit(1)
}

// ---------- публикация в бакет ----------
async function uploadFile(name, body, contentType) {
  const baseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(
    /\/+$/,
    '',
  )
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!baseUrl || !key) {
    throw new Error(
      'Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env.local для загрузки в бакет.',
    )
  }
  const res = await fetch(`${baseUrl}/storage/v1/object/${BUCKET}/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body,
  })
  if (!res.ok) {
    throw new Error(`Не удалось залить ${name}: ${res.status} ${await res.text()}`)
  }
  console.log(`Залито: ${name}`)
}

if (doUpload) {
  if (!existsSync(sigPath)) {
    console.error(
      `Не найдена подпись ${sigPath}. Проверьте TAURI_SIGNING_PRIVATE_KEY и пароль к ключу.`,
    )
    process.exit(1)
  }
  const signature = readFileSync(sigPath, 'utf8').trim()
  const baseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(
    /\/+$/,
    '',
  )
  const latest = {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: {
      'windows-x86_64': {
        signature,
        url: `${baseUrl}/storage/v1/object/public/${BUCKET}/${exeName}`,
      },
    },
  }
  const latestPath = join(bundleDir, 'latest.json')
  writeFileSync(latestPath, `${JSON.stringify(latest, null, 2)}\n`, 'utf8')

  await uploadFile(exeName, readFileSync(exePath), 'application/vnd.microsoft.portable-executable')
  await uploadFile(`${exeName}.sig`, readFileSync(sigPath), 'text/plain')
  await uploadFile('latest.json', readFileSync(latestPath), 'application/json')
  console.log('Обновление опубликовано. Приложение предложит его при следующем запуске.')
}

// ---------- локальная установка ----------
if (doLocal) {
  console.log('Локальная установка новой версии…')
  // /S — тихая установка NSIS. Установщик сам закрывает старую версию,
  // ставит новую и запускает приложение.
  const child = spawn(exePath, ['/S'], { detached: true, stdio: 'ignore' })
  child.unref()
  console.log(`Готово: Nucleus ${version} ставится локально.`)
}

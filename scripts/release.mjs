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
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
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

// ---------- ключ подписи ----------
// Tauri ждёт сам ключ в переменной TAURI_SIGNING_PRIVATE_KEY, а не путь к файлу.
// Если переменная не задана, сами находим файл ключа и читаем его.
function ensureSigningKey() {
  const current = process.env.TAURI_SIGNING_PRIVATE_KEY
  // Если в переменной лежит путь к файлу — подменяем его содержимым.
  if (current && current.trim()) {
    const asPath = current.trim()
    if (!asPath.includes('\n') && existsSync(asPath)) {
      process.env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(asPath, 'utf8').trim()
    }
    return
  }
  const candidates = [
    process.env.TAURI_SIGNING_PRIVATE_KEY_PATH,
    join(homedir(), '.tauri', 'nucleus.key'),
    join(root, 'src-tauri', 'nucleus.key'),
  ].filter(Boolean)
  for (const file of candidates) {
    if (existsSync(file)) {
      process.env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(file, 'utf8').trim()
      console.log(`Ключ подписи взят из ${file}`)
      return
    }
  }
}
ensureSigningKey()

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
  const hasSigningKey = Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY)

  // Локальная установка не передаёт обновление другим устройствам и не нуждается
  // в .sig. Собираем её без updater-артефактов, если ключа на ПК нет. Исходный
  // tauri.conf.json сразу восстанавливается, поэтому облачные релизы не меняются.
  if (doUpload && !hasSigningKey) {
    console.error(
      'Для публикации обновления нужен приватный ключ подписи: %USERPROFILE%\\.tauri\\nucleus.key\n' +
        'или TAURI_SIGNING_PRIVATE_KEY в .env.local.',
    )
    process.exit(1)
  }

  const localWithoutSigning = doLocal && !doUpload && !hasSigningKey
  const savedConfig = JSON.stringify(conf, null, 2)
  if (localWithoutSigning) {
    conf.bundle = { ...conf.bundle, createUpdaterArtifacts: false }
    writeFileSync(confPath, `${JSON.stringify(conf, null, 2)}\n`, 'utf8')
    console.log('Ключ подписи не найден: локальная сборка будет без .sig (это нормально).')
  } else if (!process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
    console.warn('Внимание: TAURI_SIGNING_PRIVATE_KEY_PASSWORD не задан. Подпись обновления может не создаться.')
  }

  console.log('Сборка установщика…')
  try {
    execFileSync('npm', ['run', 'tauri', 'build'], {
      cwd: root,
      stdio: 'inherit',
      shell: true,
    })
  } finally {
    if (localWithoutSigning) {
      writeFileSync(confPath, `${savedConfig}\n`, 'utf8')
    }
  }
}

if (!existsSync(exePath)) {
  console.error(`Не найден установщик: ${exePath}`)
  process.exit(1)
}

// ---------- Сохранение в постоянную папку releases/ ----------
const releasesDir = join(root, 'releases')
if (!existsSync(releasesDir)) {
  mkdirSync(releasesDir, { recursive: true })
}
const destExePath = join(releasesDir, exeName)
try {
  copyFileSync(exePath, destExePath)
  console.log(`Установочный файл Windows скопирован в: releases/${exeName}`)
} catch (e) {
  console.warn(`Не удалось скопировать EXE в releases/: ${e.message}`)
}

const apkSource = join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
if (existsSync(apkSource)) {
  const apkDest = join(releasesDir, `Nucleus_${version}.apk`)
  try {
    copyFileSync(apkSource, apkDest)
    console.log(`Android APK скопирован в: releases/Nucleus_${version}.apk`)
  } catch (e) {
    console.warn(`Не удалось скопировать APK в releases/: ${e.message}`)
  }
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

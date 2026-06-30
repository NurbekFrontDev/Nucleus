// Прогоняет SQL-файл миграции по строке подключения Supabase.
//
// Использование (PowerShell):
//   npm i -D pg
//   $env:DB_URL="postgresql://postgres:ПАРОЛЬ@db.ewgrcmswwvbtoxdxkvuv.supabase.co:5432/postgres"
//   node run-migration.mjs supabase/migration-water-portion.sql
//
// Пароль БД и строка подключения: Supabase -> Project Settings -> Database.

import { readFileSync } from 'node:fs'
import pg from 'pg'

const file = process.argv[2]
if (!file) {
  console.error('Укажи путь к SQL-файлу, например: node run-migration.mjs supabase/migration-water-portion.sql')
  process.exit(1)
}

const connectionString = process.env.DB_URL
if (!connectionString) {
  console.error('Не задана переменная DB_URL (строка подключения Supabase).')
  process.exit(1)
}

const sql = readFileSync(file, 'utf8')
const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
})

try {
  await client.connect()
  await client.query(sql)
  console.log(`✅ Миграция выполнена: ${file}`)
} catch (err) {
  console.error('❌ Ошибка миграции:', err.message)
  process.exit(1)
} finally {
  await client.end()
}

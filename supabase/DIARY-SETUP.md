# Nucleus — Настройка Supabase для модуля «Дневник» (v0.1.54)

> [!warning] Выполняется один раз, под аккаунтом Supabase, где живёт проект Nucleus
> (`ewgrcmswwvbtoxdxkvuv`). CLI на этом компьютере залогинен под другим аккаунтом
> (Sos Shield), поэтому сначала `supabase login` под нужным аккаунтом.
> Всё, что ниже — единственные шаги в Supabase, остальное в модуле уже готово в коде.

## 1. Логин CLI под аккаунтом Nucleus

```bash
supabase login
```

Откроется браузер — авторизуйтесь под аккаунтом, которому принадлежит проект `ewgrcmswwvbtoxdxkvuv`, и подтвердите доступ CLI. Проверка:

```bash
supabase projects list
```

В списке должен появиться проект Nucleus (`ewgrcmswwvbtoxdxkvuv`).

## 2. SQL-миграция (таблицы, RLS, realtime, бакет)

Supabase Dashboard → проект Nucleus → **SQL Editor → New query** → вставить целиком содержимое [`migration-diary.sql`](migration-diary.sql) → **Run**.

Скрипт идемпотентный (безопасно запускать повторно) и создаёт:
- таблицы `diary_entries`, `diary_experiments` + RLS «только свои записи»;
- realtime-публикацию обеих таблиц;
- приватный бакет `diary-audio` с политиками владельца.

Альтернатива через CLI (спросит пароль БД):

```bash
supabase db execute --project-ref ewgrcmswwvbtoxdxkvuv --file supabase/migration-diary.sql
```

## 3. Секреты и деплой Edge Function `diary-ai`

Один клик — скрипт (делает secrets set + deploy):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/diary-setup.ps1 -GeminiKey "<GEMINI_API_KEY>" -GroqKey "<GROQ_API_KEY>"
```

Или вручную:

```bash
supabase secrets set GEMINI_API_KEY=... GROQ_API_KEY=... --project-ref ewgrcmswwvbtoxdxkvuv
supabase functions deploy diary-ai --project-ref ewgrcmswwvbtoxdxkvuv
```

Где взять ключи (оба уже есть на этом компьютере):
- **GEMINI_API_KEY** — `F:\Apps\Voxel_v2\config.json` → поле `api_key` (формат `AQ.Ab8…`).
- **GROQ_API_KEY** — `F:\Apps\Voxel_v2\config.json` → поле `groq_api_key` (формат `gsk_…`); тот же ключ лежит в `F:\Apps\Echo\.env` → `GROQ_API_KEY`.

## 4. Lifecycle-очистка бакета (транспорт, D8)

Dashboard → **Storage → Settings → Object limits & rules** (или Policies бакета `diary-audio`) → добавить правило авто-удаления объектов **старше 30 дней**. Бакет — только транспорт: вечные копии аудио живут в вольте + Google Drive.

## 5. Google Drive (вечный облачный бэкап аудио)

Клиент **Google Drive for Desktop** → добавить в синхронизацию папку:

```
F:\SecondBrain\personal\Diary\audio
```

Ноль кода: структура `audio\ГГГГ\ММ\` зеркалится в Drive. Аудио исключено из git-синка вольта (`.gitignore` уже содержит `personal/Diary/audio/`).

## 6. Проверка (живой тест)

1. Открыть Nucleus → вкладка **📓 Дневник**.
2. Нажать 🎙, сказать 20–30 секунд (ru/en/uz) → отпустить.
3. Ожидаемо: карточка «Транскрибация…» → «AI-выжимка…» → готовая карточка с заголовком, выжимкой, тегами, настроением.
4. На ПК в статусе появится «Не в вольте: N» → кнопка «⤓ Синхронизировать вольт» (или автосинк через ~3 сек).
5. В Obsidian открыть `F:\SecondBrain\personal\Diary\2026\09\2026-09-28.md` — выжимка сверху, оригинал дословно снизу, `**Аудио:** ![[…webm]]`.
6. Запись с телефона: сделать голосовую запись в приложении на телефоне → на ПК (после запуска) она дотранскрибируется и уедет в вольт автоматически.
7. Эксперименты: скажите в записи «начинаю 30 дней power nap» — блок 🧪 Эксперименты появится с «день 1 из 30» и советом коуча.

## Если что-то не работает

- **«AI не ответил» в карточке** → проверьте деплой: `supabase functions list --project-ref ewgrcmswwvbtoxdxkvuv`; логи: `supabase functions logs diary-ai --project-ref ewgrcmswwvbtoxdxkvuv`.
- **Таблицы не создались** → проверьте, что SQL выполнен без ошибок (SQL Editor показывает результат).
- **Транскрипт пустой** → секрет `GEMINI_API_KEY` задан? `supabase secrets list --project-ref ewgrcmswwvbtoxdxkvuv`.

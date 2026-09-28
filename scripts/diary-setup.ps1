# Nucleus Diary Setup: секреты + деплой Edge Function diary-ai (v0.1.54).
# Перед запуском: supabase login под аккаунтом проекта Nucleus (ewgrcmswwvbtoxdxkvuv).
# Полная инструкция — supabase/DIARY-SETUP.md.
param(
    [Parameter(Mandatory = $true)][string]$GeminiKey,
    [Parameter(Mandatory = $true)][string]$GroqKey,
    [string]$ProjectRef = "ewgrcmswwvbtoxdxkvuv"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    Write-Host "== Nucleus Diary Setup ($ProjectRef) ==" -ForegroundColor Cyan

    Write-Host "`n[1/3] Секреты Supabase (GEMINI_API_KEY, GROQ_API_KEY)..." -ForegroundColor Yellow
    supabase secrets set "GEMINI_API_KEY=$GeminiKey" "GROQ_API_KEY=$GroqKey" --project-ref $ProjectRef
    if ($LASTEXITCODE -ne 0) { throw "secrets set failed (проверь supabase login под аккаунтом Nucleus)" }

    Write-Host "`n[2/3] Деплой Edge Function diary-ai..." -ForegroundColor Yellow
    supabase functions deploy diary-ai --project-ref $ProjectRef
    if ($LASTEXITCODE -ne 0) { throw "functions deploy failed" }

    Write-Host "`n[3/3] Проверка деплоя..." -ForegroundColor Yellow
    supabase functions list --project-ref $ProjectRef | Select-String "diary-ai"

    Write-Host "`n[OK] diary-ai задеплоен. SQL-миграцию (если ещё не) выполни в SQL Editor:" -ForegroundColor Green
    Write-Host "     supabase/migration-diary.sql  (инструкция: supabase/DIARY-SETUP.md)" -ForegroundColor Green
    Write-Host "Затем: Nucleus -> Дневник -> голосовая запись." -ForegroundColor Green
} finally {
    Pop-Location
}

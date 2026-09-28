# Nucleus Diary Setup: set Edge Function secrets + deploy diary-ai (v0.1.54).
# Prerequisite: 'supabase login' under the Nucleus project account (ewgrcmswwvbtoxdxkvuv).
# Full guide: supabase/DIARY-SETUP.md.
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

    Write-Host "[1/3] Setting Supabase secrets (GEMINI_API_KEY, GROQ_API_KEY)..." -ForegroundColor Yellow
    supabase secrets set "GEMINI_API_KEY=$GeminiKey" "GROQ_API_KEY=$GroqKey" --project-ref $ProjectRef
    if ($LASTEXITCODE -ne 0) { throw "secrets set failed (run 'supabase login' under the Nucleus account first)" }

    Write-Host "[2/3] Deploying Edge Function diary-ai..." -ForegroundColor Yellow
    supabase functions deploy diary-ai --project-ref $ProjectRef --no-verify-jwt=false
    if ($LASTEXITCODE -ne 0) { throw "functions deploy failed" }

    Write-Host "[3/3] Verifying deployment..." -ForegroundColor Yellow
    supabase functions list --project-ref $ProjectRef | Select-String "diary-ai"

    Write-Host "[OK] diary-ai deployed. If the SQL migration is not applied yet, run supabase/migration-diary.sql in the SQL Editor (guide: supabase/DIARY-SETUP.md)." -ForegroundColor Green
    Write-Host "Then: Nucleus -> Diary -> record your first voice entry." -ForegroundColor Green
} finally {
    Pop-Location
}

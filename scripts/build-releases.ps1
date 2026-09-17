# Nucleus Unified Release Builder
# Compiles both Windows Setup Installer and Android Release APK into releases\
param(
    [switch]$SkipAndroid = $false,
    [switch]$SkipWindows = $false
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

# 1. Read version from package.json
$pkgJson = Get-Content (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
$versionName = $pkgJson.version
if (-not $versionName) { throw "package.json must define version" }

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Building Nucleus v$versionName" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$releasesDir = Join-Path $repoRoot "releases"
New-Item -ItemType Directory -Path $releasesDir -Force | Out-Null

# 2. Windows Installer (Tauri NSIS)
$installerOut = Join-Path $releasesDir "Nucleus_${versionName}_x64-setup.exe"
if (-not $SkipWindows) {
    Write-Host "`n[1/2] Building Windows Installer (Tauri)..." -ForegroundColor Yellow
    Push-Location $repoRoot
    try {
        & node scripts/release.mjs --local --skip-build=false --bump=none
        if ($LASTEXITCODE -ne 0) {
            throw "Tauri build failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }

    $rawInstaller = Join-Path $repoRoot "src-tauri\target\release\bundle\nsis\Nucleus_${versionName}_x64-setup.exe"
    if (Test-Path $rawInstaller) {
        Copy-Item -LiteralPath $rawInstaller -Destination $installerOut -Force
        # Очищаем промежуточный файл во избежание дубликатов
        Remove-Item -LiteralPath $rawInstaller -Force -ErrorAction SilentlyContinue
    }

    if (-not (Test-Path $installerOut)) {
        throw "Windows Installer was not found at $installerOut"
    }

    $winSize = (Get-Item $installerOut).Length / 1MB
    Write-Host "[OK] Windows Installer ready: $installerOut ($([math]::Round($winSize, 2)) MB)" -ForegroundColor Green
} else {
    Write-Host "`n[1/2] Skipping Windows Installer build (-SkipWindows specified)" -ForegroundColor Gray
}

# 3. Android Release APK (Capacitor)
$apkOut = Join-Path $releasesDir "Nucleus_${versionName}.apk"
if (-not $SkipAndroid) {
    Write-Host "`n[2/2] Building Android Release APK (Capacitor)..." -ForegroundColor Yellow
    Push-Location $repoRoot
    try {
        Write-Host "-> npx cap sync android..." -ForegroundColor Yellow
        & npx cap sync android
        if ($LASTEXITCODE -ne 0) {
            throw "Capacitor sync failed with exit code $LASTEXITCODE"
        }

        Write-Host "-> Building signed Release APK with Gradle..." -ForegroundColor Yellow
        Push-Location (Join-Path $repoRoot "android")
        try {
            & .\gradlew assembleRelease
            if ($LASTEXITCODE -ne 0) {
                throw "Gradle assembleRelease failed with exit code $LASTEXITCODE"
            }
        } finally {
            Pop-Location
        }
    } finally {
        Pop-Location
    }

    $rawApk = Join-Path $repoRoot "android\app\build\outputs\apk\release\app-release.apk"
    if (-not (Test-Path $rawApk)) {
        throw "Android Release APK was not found at $rawApk"
    }

    Copy-Item -LiteralPath $rawApk -Destination $apkOut -Force
    Remove-Item -LiteralPath $rawApk -Force -ErrorAction SilentlyContinue
    $apkSize = (Get-Item $apkOut).Length / 1MB
    Write-Host "[OK] Android APK ready: $apkOut ($([math]::Round($apkSize, 2)) MB)" -ForegroundColor Green

    # Auto-install to connected phone via USB ADB
    try {
        $adbDevices = & adb devices | Select-String -Pattern "device$"
        if ($adbDevices) {
            Write-Host "`n[ADB] Connected Android device detected. Installing $apkOut..." -ForegroundColor Yellow
            & adb install -r $apkOut
            if ($LASTEXITCODE -eq 0) {
                Write-Host "[OK] Successfully deployed APK to Android phone via ADB!" -ForegroundColor Green
            } else {
                Write-Warning "ADB install exited with code $LASTEXITCODE"
            }
        } else {
            Write-Host "`n[ADB] No Android device connected via USB ADB, skipping direct install." -ForegroundColor Gray
        }
    } catch {
        Write-Warning "ADB check/install failed: $_"
    }
} else {
    Write-Host "`n[2/2] Skipping Android APK build (-SkipAndroid specified)" -ForegroundColor Gray
}

Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host " Release artifacts in releases\:" -ForegroundColor Cyan
Get-ChildItem $releasesDir | Where-Object { $_.Name -like "*$versionName*" } | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
Write-Host "==========================================" -ForegroundColor Cyan

@echo off
setlocal

set "ROOT=%~dp0.."
set "CONFIG=%ROOT%\router.config.json"
set "PORT=3456"
set "KEY=dev-router-key"

if not exist "%CONFIG%" (
  echo Missing router.config.json
  echo Copy router.config.example.json to router.config.json and add your upstreams first.
  exit /b 1
)

for /f "tokens=2 delims=:, " %%P in ('findstr /C:"\"port\"" "%CONFIG%" 2^>nul') do (
  set "PORT=%%~P"
  goto :got_port
)
:got_port

for /f "tokens=2 delims=:, " %%K in ('findstr /C:"\"routerApiKey\"" "%CONFIG%" 2^>nul') do (
  set "KEY=%%~K"
  goto :got_key
)
:got_key

powershell -NoProfile -Command "try { $r = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:%PORT%/health' -TimeoutSec 1; exit 0 } catch { exit 1 }" >nul 2>nul
if errorlevel 1 (
  echo Starting tiny-router on http://127.0.0.1:%PORT%
  start "tiny-router" cmd /k "cd /d "%ROOT%" && npm start"
  echo Waiting for tiny-router...
  powershell -NoProfile -Command "$deadline=(Get-Date).AddSeconds(10); do { try { Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:%PORT%/health' -TimeoutSec 1 | Out-Null; exit 0 } catch { Start-Sleep -Milliseconds 300 } } while ((Get-Date) -lt $deadline); exit 1"
  if errorlevel 1 (
    echo tiny-router did not become healthy on port %PORT%.
    exit /b 1
  )
) else (
  echo tiny-router is already running on http://127.0.0.1:%PORT%
)

set "ANTHROPIC_AUTH_TOKEN="
set "ANTHROPIC_BASE_URL=http://127.0.0.1:%PORT%"
set "ANTHROPIC_API_KEY=%KEY%"

echo Launching Claude Code through tiny-router...
echo ANTHROPIC_BASE_URL=%ANTHROPIC_BASE_URL%
claude

@echo off
set "ROOT=%~dp0"
set "CONFIG=%ROOT%router.config.json"
set "PORT=3456"
set "KEY=local-router-key"

if not exist "%CONFIG%" (
  echo Missing router.config.json
  echo Copy router.config.example.json to router.config.json and add your upstreams first.
  pause
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

set "ANTHROPIC_AUTH_TOKEN="
set "ANTHROPIC_BASE_URL=http://127.0.0.1:%PORT%"
set "ANTHROPIC_API_KEY=%KEY%"

cd /d "%ROOT%"
echo Launching Claude Code through tiny-router...
echo ANTHROPIC_BASE_URL=%ANTHROPIC_BASE_URL%
claude

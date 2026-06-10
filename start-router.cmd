@echo off
setlocal

set "ROOT=%~dp0"
set "CONFIG=%ROOT%router.config.json"

if not exist "%CONFIG%" (
  echo Missing router.config.json
  echo Copy router.config.example.json to router.config.json and add your upstreams first.
  pause
  exit /b 1
)

cd /d "%ROOT%"
node src/server.js

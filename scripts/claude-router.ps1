param(
  [string]$Config = (Join-Path $PSScriptRoot '..\router.config.json')
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')

if (-not (Test-Path $Config)) {
  Write-Error 'Missing router.config.json. Copy router.config.example.json to router.config.json and add your upstreams first.'
}

$configJson = Get-Content $Config -Raw | ConvertFrom-Json
$port = if ($configJson.listen.port) { [int]$configJson.listen.port } else { 3456 }
$key = if ($configJson.routerApiKey) { [string]$configJson.routerApiKey } else { 'dev-router-key' }
$baseUrl = "http://127.0.0.1:$port"

function Test-RouterHealth {
  try {
    Invoke-RestMethod -UseBasicParsing -Uri "$baseUrl/health" -TimeoutSec 1 | Out-Null
    return $true
  } catch {
    return $false
  }
}

if (-not (Test-RouterHealth)) {
  Write-Host "Starting tiny-router on $baseUrl"
  Start-Process powershell -ArgumentList @(
    '-NoExit',
    '-Command',
    "Set-Location '$Root'; npm start"
  ) | Out-Null

  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $deadline) {
    if (Test-RouterHealth) { break }
    Start-Sleep -Milliseconds 300
  }

  if (-not (Test-RouterHealth)) {
    throw "tiny-router did not become healthy on $baseUrl"
  }
} else {
  Write-Host "tiny-router is already running on $baseUrl"
}

Remove-Item Env:ANTHROPIC_AUTH_TOKEN -ErrorAction SilentlyContinue
$env:ANTHROPIC_BASE_URL = $baseUrl
$env:ANTHROPIC_API_KEY = $key

Write-Host "Launching Claude Code through tiny-router..."
Write-Host "ANTHROPIC_BASE_URL=$env:ANTHROPIC_BASE_URL"
claude

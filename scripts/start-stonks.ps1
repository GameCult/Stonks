param(
  [int] $Port = 8802,
  [string] $StateDir = "E:\Projects\Stonks\scratch\stonks",
  [string] $FinnhubTokenFile = "E:\Projects\Stonks\finnhub-oauth.txt",
  [string] $IdunnRudpHealth = "127.0.0.1:17870",
  [string] $IdunnDaemon = "stonks",
  [string] $IdunnHealthContract = "stonks.cultnet-rudp-market-health",
  [switch] $Foreground
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $repoRoot "src\stonks-daemon.cjs"
$pidPath = Join-Path $StateDir "stonks.pid"
$outLog = Join-Path $StateDir "stonks.out.log"
$errLog = Join-Path $StateDir "stonks.err.log"

New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

if (Test-Path $pidPath) {
  $oldPid = (Get-Content -Raw $pidPath).Trim()
  if ($oldPid -match "^\d+$") {
    $old = Get-Process -Id ([int] $oldPid) -ErrorAction SilentlyContinue
    if ($old) {
      throw "Stonks already appears to be running as PID $oldPid."
    }
  }
  Remove-Item -LiteralPath $pidPath -Force
}

$env:NODE_PATH = "E:\Projects\CultLib\packages"
$env:STONKS_FINNHUB_TOKEN_FILE = $FinnhubTokenFile
$args = @(
  $scriptPath,
  "--port", "$Port",
  "--stateDir", $StateDir,
  "--finnhubTokenFile", $FinnhubTokenFile,
  "--idunn-rudp-health", $IdunnRudpHealth,
  "--idunn-daemon", $IdunnDaemon,
  "--idunn-health-contract", $IdunnHealthContract
)

if ($Foreground) {
  & node @args
  exit $LASTEXITCODE
}

$proc = Start-Process -FilePath "node" -ArgumentList $args -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
$proc.Id | Set-Content -Encoding ASCII -LiteralPath $pidPath
Start-Sleep -Seconds 1
if ($proc.HasExited) {
  $detail = ""
  if (Test-Path $outLog) { $detail += Get-Content -Raw $outLog }
  if (Test-Path $errLog) { $detail += Get-Content -Raw $errLog }
  throw "Stonks exited immediately with code $($proc.ExitCode).`n$detail"
}

Write-Host "Stonks started as PID $($proc.Id)."
Write-Host "Health: http://127.0.0.1:$Port/health"
Write-Host "Eve deck: ws://127.0.0.1:$Port/eve/deck"

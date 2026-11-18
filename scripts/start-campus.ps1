param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtime = Join-Path $root '.local-runtime'
if (-not (Test-Path $runtime)) { New-Item -ItemType Directory -Path $runtime | Out-Null }
$pidFile = Join-Path $runtime 'campus-processes.json'
$pids = @{}
if (Test-Path $pidFile) {
  $saved = Get-Content -Raw $pidFile | ConvertFrom-Json
  if ($saved.backend) { $pids.backend = [int]$saved.backend }
  if ($saved.frontend) { $pids.frontend = [int]$saved.frontend }
}
function ApiReady {
  try { return ((Invoke-RestMethod 'http://127.0.0.1:8000/api/health' -TimeoutSec 2).status -eq 'ok') }
  catch { return $false }
}
function WebReady {
  try { return ((Invoke-WebRequest 'http://127.0.0.1:5173/' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) }
  catch { return $false }
}
function PortOccupied([int]$port) {
  $client = New-Object Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect('127.0.0.1', $port, $null, $null)
    return ($async.AsyncWaitHandle.WaitOne(600, $false) -and $client.Connected)
  } catch { return $false }
  finally { $client.Close() }
}
function LaunchApp([string]$name,[string]$script) {
  if (-not (Test-Path $script)) { throw "Missing startup script for $name" }
  $exe = (Get-Command powershell.exe).Source
  $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $script + '"'
  $out = Join-Path $runtime ($name + '.stdout.log')
  $err = Join-Path $runtime ($name + '.stderr.log')
  $p = Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
  $pids[$name] = $p.Id
  Write-Output ("Starting {0}, process {1}" -f $name, $p.Id)
}
function WaitUntil([scriptblock]$probe,[string]$label,[int]$limit=25) {
  for($i=0; $i -lt $limit; $i++) {
    if (& $probe) { Write-Output "$label ready"; return }
    Start-Sleep -Seconds 1
  }
  throw "$label did not become ready. Inspect .local-runtime logs."
}
Write-Output 'Checking dedicated PostgreSQL 18 cluster...'
& (Join-Path $PSScriptRoot 'start-postgres.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Could not start private database' }
if (ApiReady) { Write-Output 'FastAPI already running; leaving it untouched.' }
else {
  if (PortOccupied 8000) { throw 'Port 8000 is occupied by a non-responsive service. No processes were terminated.' }
  LaunchApp 'backend' (Join-Path $PSScriptRoot 'start-backend.ps1')
  $pids | ConvertTo-Json | Set-Content -Encoding ASCII $pidFile
  WaitUntil { ApiReady } 'FastAPI'
}
if (WebReady) { Write-Output 'Frontend already running; leaving it untouched.' }
else {
  if (PortOccupied 5173) { throw 'Port 5173 is occupied by a non-responsive service. No processes were terminated.' }
  LaunchApp 'frontend' (Join-Path $PSScriptRoot 'start-frontend.ps1')
  $pids | ConvertTo-Json | Set-Content -Encoding ASCII $pidFile
  WaitUntil { WebReady } 'Vite'
}
$pids | ConvertTo-Json | Set-Content -Encoding ASCII $pidFile
$api = Invoke-RestMethod 'http://127.0.0.1:8000/api/health' -TimeoutSec 5
if ($api.database -ne 'connected') { throw 'Backend is not connected to the database' }
Write-Output 'Campus Continuity is ready:'
Write-Output 'Frontend: http://127.0.0.1:5173/'
Write-Output 'API health: http://127.0.0.1:8000/api/health'
Write-Output 'Stop app: powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-campus.ps1'
if (-not $NoBrowser) {
  $chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
  if (Test-Path $chrome) { Start-Process -FilePath $chrome -ArgumentList 'http://127.0.0.1:5173/' }
  else { Start-Process 'http://127.0.0.1:5173/' }
}

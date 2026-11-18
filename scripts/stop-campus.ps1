param([switch]$IncludeDatabase)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtime = Join-Path $root '.local-runtime'
$pidFile = Join-Path $runtime 'campus-processes.json'

function StopTracked([string]$name,[int]$pidToStop,[string]$scriptName) {
  $rootProc = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $pidToStop) -ErrorAction SilentlyContinue
  if (-not $rootProc) { Write-Output "$name already stopped"; return }
  if (-not $rootProc.CommandLine -or -not $rootProc.CommandLine.Contains($scriptName)) {
    Write-Warning ("Refusing to stop PID " + $pidToStop + ": it no longer belongs to the campus startup script.")
    return
  }
  $procs = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId)
  function Descendants([int]$parent) {
    foreach($child in ($procs | Where-Object { $_.ParentProcessId -eq $parent })) {
      Descendants ([int]$child.ProcessId)
      Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
  Descendants $pidToStop
  Stop-Process -Id $pidToStop -Force -ErrorAction SilentlyContinue
  Write-Output "$name stopped"
}

if (Test-Path $pidFile) {
  $saved = Get-Content -Raw $pidFile | ConvertFrom-Json
  if ($saved.frontend) { StopTracked 'Frontend' ([int]$saved.frontend) 'start-frontend.ps1' }
  if ($saved.backend) { StopTracked 'FastAPI' ([int]$saved.backend) 'start-backend.ps1' }
  Remove-Item $pidFile -Force
} else {
  Write-Output 'No tracked campus app processes found. Unrelated processes were not touched.'
}
if ($IncludeDatabase) {
  $data = Join-Path $runtime 'postgres18'
  $bin = 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe'
  if ((Test-Path (Join-Path $data 'PG_VERSION')) -and (Test-Path $bin)) {
    & $bin -D $data -m fast -w stop
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL did not stop cleanly' }
    Write-Output 'Project-local PostgreSQL stopped. Data files preserved.'
  } else {
    Write-Output 'Project-local PostgreSQL cluster not present; nothing was stopped.'
  }
} else {
  Write-Output 'Project-local PostgreSQL left running to preserve fast startup.'
}
Write-Output 'Safe shutdown finished. No database files or other projects were deleted.'

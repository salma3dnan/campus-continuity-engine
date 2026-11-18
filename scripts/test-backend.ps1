$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'load-env.ps1')
$env:DATABASE_URL = $env:DATABASE_URL.Replace('/' + ($env:DATABASE_URL.Split('/')[-1]), '/continuity_test?connect_timeout=5')
if ($env:DATABASE_URL -notmatch '/continuity_test\?connect_timeout=5$') {
  throw 'Refusing tests against a non-test database'
}
Set-Location (Join-Path $root 'backend')
& '.\.venv\Scripts\python.exe' -m alembic upgrade head
if ($LASTEXITCODE -ne 0) { throw 'Test DB migration failed' }
& '.\.venv\Scripts\python.exe' -m pytest -q
exit $LASTEXITCODE

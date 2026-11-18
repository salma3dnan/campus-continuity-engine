$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'load-env.ps1')
Set-Location (Join-Path $root 'backend')
& '.\.venv\Scripts\python.exe' -m alembic upgrade head
if ($LASTEXITCODE -ne 0) { throw 'Migration failed' }
& '.\.venv\Scripts\python.exe' -m app.seed
if ($LASTEXITCODE -ne 0) { throw 'Demo seed failed' }
& '.\.venv\Scripts\python.exe' -m uvicorn app.main:app --host 127.0.0.1 --port 8000

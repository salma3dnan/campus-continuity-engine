$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location (Join-Path $root 'frontend')
& npm.cmd run dev -- --host 127.0.0.1 --port 5173

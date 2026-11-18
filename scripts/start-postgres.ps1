param([int]$Port = 5440)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtime = Join-Path $root '.local-runtime'
$data = Join-Path $runtime 'postgres18'
$bin = 'C:\Program Files\PostgreSQL\18\bin'
if (-not (Test-Path (Join-Path $bin 'initdb.exe'))) {
  throw 'PostgreSQL 18 local installation was not found.'
}
if (!(Test-Path $runtime)) { New-Item -ItemType Directory -Path $runtime | Out-Null }
$cfg = @{}
Get-Content -LiteralPath (Join-Path $root '.env') | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') { $cfg[$Matches[1]] = $Matches[2] }
}
if (-not $cfg.POSTGRES_PASSWORD -or -not $cfg.POSTGRES_USER) {
  throw 'Missing local POSTGRES_USER or POSTGRES_PASSWORD in .env.'
}
$env:PGPASSWORD = $cfg.POSTGRES_PASSWORD
$env:PGCONNECT_TIMEOUT = '5'
if (-not (Test-Path (Join-Path $data 'PG_VERSION'))) {
  if (Test-Path $data) { throw 'Database directory exists without PG_VERSION; not overwriting.' }
  $passwordFile = Join-Path $runtime 'pg-init-secret.tmp'
  try {
    [IO.File]::WriteAllText($passwordFile, $cfg.POSTGRES_PASSWORD + [Environment]::NewLine)
    & (Join-Path $bin 'initdb.exe') -D $data -U $cfg.POSTGRES_USER --encoding=UTF8 --auth-host=scram-sha-256 --auth-local=scram-sha-256 --pwfile=$passwordFile --no-instructions
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL cluster initialization failed' }
  } finally {
    if (Test-Path $passwordFile) { Remove-Item -LiteralPath $passwordFile -Force }
  }
}
& (Join-Path $bin 'pg_isready.exe') -h 127.0.0.1 -p $Port -t 2 *> $null
if ($LASTEXITCODE -ne 0) {
  $logFile = Join-Path $runtime 'postgres18.log'
  & (Join-Path $bin 'pg_ctl.exe') -D $data -l $logFile -o "-c listen_addresses=127.0.0.1 -p $Port" -w start
  if ($LASTEXITCODE -ne 0) { throw 'Unable to start local PostgreSQL cluster' }
}
foreach($database in @($cfg.POSTGRES_DB,'continuity_test')) {
  $exists = & (Join-Path $bin 'psql.exe') -h 127.0.0.1 -p $Port -U $cfg.POSTGRES_USER -d postgres -At -c "SELECT 1 FROM pg_database WHERE datname='$database'"
  if ($LASTEXITCODE -ne 0) { throw "Cannot inspect database $database" }
  if ($exists -ne '1') {
    & (Join-Path $bin 'createdb.exe') -h 127.0.0.1 -p $Port -U $cfg.POSTGRES_USER $database
    if ($LASTEXITCODE -ne 0) { throw "Failed to create $database" }
  }
}
& (Join-Path $bin 'pg_isready.exe') -h 127.0.0.1 -p $Port
Write-Output "Isolated PostgreSQL 18 is ready at 127.0.0.1:$Port"

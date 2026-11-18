$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$cfg = @{}
Get-Content -LiteralPath (Join-Path $root '.env') | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') { $cfg[$Matches[1]] = $Matches[2] }
}
$env:PGPASSWORD = $cfg.POSTGRES_PASSWORD
$env:DATABASE_URL = 'postgresql+psycopg://' + $cfg.POSTGRES_USER + ':' + $cfg.POSTGRES_PASSWORD + '@127.0.0.1:5440/' + $cfg.POSTGRES_DB + '?connect_timeout=5'
$env:SECRET_KEY = $cfg.SECRET_KEY
$env:DEMO_ADMIN_USERNAME = $cfg.DEMO_ADMIN_USERNAME
$env:DEMO_ADMIN_PASSWORD = $cfg.DEMO_ADMIN_PASSWORD
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
function Query([string]$sql) {
  $output = & $psql -h 127.0.0.1 -p 5440 -U $cfg.POSTGRES_USER -d $cfg.POSTGRES_DB -At -v ON_ERROR_STOP=1 -c $sql
  if ($LASTEXITCODE -ne 0) { throw "SQL verification failed" }
  return ($output | Out-String).Trim()
}
$countsSql = "SELECT (SELECT count(*) FROM buildings)||','||(SELECT count(*) FROM rooms)||','||(SELECT count(*) FROM sessions)||','||(SELECT count(*) FROM disruptions)"
$before = Query $countsSql
Push-Location (Join-Path $root 'backend')
try {
  & '.\.venv\Scripts\python.exe' -m app.seed
  if ($LASTEXITCODE -ne 0) { throw 'Repeat seed failed' }
} finally { Pop-Location }
$after = Query $countsSql
if ($before -ne $after) { throw "Repeat seed changed entity counts: $before versus $after" }
Write-Output "SEED_IDEMPOTENT=True; buildings,rooms,sessions,incidents=$after"
$overlapSql = "SELECT count(*) FROM sessions a JOIN sessions b ON a.id < b.id AND a.is_active AND b.is_active AND a.room_id=b.room_id AND tstzrange(a.start_at,a.end_at,'[)') && tstzrange(b.start_at,b.end_at,'[)')"
$overlaps = Query $overlapSql
Write-Output "ACTIVE_OVERLAPPING_BOOKINGS=$overlaps"
if ($overlaps -ne '0') { throw 'Duplicate active room bookings detected' }
$constraint = Query "SELECT count(*) FROM pg_constraint WHERE conname='no_active_room_overlap'"
Write-Output "POSTGRES_EXCLUSION_CONSTRAINT=$constraint"
if ($constraint -ne '1') { throw 'Missing PostgreSQL double booking exclusion constraint' }
$versions = Query 'SELECT version_num FROM alembic_version'
Write-Output "ALEMBIC_VERSION=$versions"
if ($versions -ne '0001_initial') { throw 'Unexpected database migration version' }
$approved = Query "SELECT count(*) FROM proposals WHERE status='approved'"
$audited = Query "SELECT count(*) FROM audit_events WHERE action='recovery_approved'"
Write-Output "APPROVED_PLANS=$approved; RECOVERY_APPROVAL_AUDIT_EVENTS=$audited"
if ([int]$approved -lt 1 -or [int]$audited -lt 1) {
  throw 'Expected at least one real approved and audited recovery'
}
Write-Output 'DATABASE_INTEGRITY_OK'

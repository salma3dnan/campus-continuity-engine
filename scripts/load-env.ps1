$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$cfg = @{}
Get-Content -LiteralPath (Join-Path $root '.env') | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') { $cfg[$Matches[1]] = $Matches[2] }
}
$env:DATABASE_URL = 'postgresql+psycopg://' + $cfg.POSTGRES_USER + ':' + $cfg.POSTGRES_PASSWORD + '@127.0.0.1:5440/' + $cfg.POSTGRES_DB + '?connect_timeout=5'
$env:SECRET_KEY = $cfg.SECRET_KEY
$env:DEMO_ADMIN_USERNAME = $cfg.DEMO_ADMIN_USERNAME
$env:DEMO_ADMIN_PASSWORD = $cfg.DEMO_ADMIN_PASSWORD

# ---------------------------------------------------------------------------
# Plain-SQL backup of the GLOF Postgres database (Windows / PowerShell).
#
# Mirrors scripts/db/backup.sh feature-for-feature so dev (Windows) and
# VM (Linux) produce byte-equivalent dumps. Reads .env at the repo
# root, falling back to the same defaults the backend uses.
#
# Usage:
#   ./scripts/db/backup.ps1
#   $env:PG_DATABASE = 'glof_prod'; ./scripts/db/backup.ps1
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Resolve-Path (Join-Path $ScriptDir '..\..')

# Load .env if present. Inline overrides ($env:PG_HOST = ...) take
# precedence — we only set variables that aren't already defined.
$envFile = Join-Path $RootDir '.env'
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq '' -or $line.StartsWith('#')) { return }
        $eq = $line.IndexOf('=')
        if ($eq -lt 1) { return }
        $key = $line.Substring(0, $eq).Trim()
        $value = $line.Substring($eq + 1)
        if (-not (Test-Path "Env:$key")) {
            [Environment]::SetEnvironmentVariable($key, $value, 'Process')
        }
    }
}

$PgHost     = if ($env:PG_HOST)     { $env:PG_HOST }     else { 'localhost' }
$PgPort     = if ($env:PG_PORT)     { $env:PG_PORT }     else { '5432' }
$PgDatabase = if ($env:PG_DATABASE) { $env:PG_DATABASE } else { 'glof' }
$PgUser     = if ($env:PG_USER)     { $env:PG_USER }     else { 'postgres' }

# Resolve pg_dump.exe — most Windows Postgres installers don't add the
# bin/ dir to PATH, so we look in the standard install locations and
# fall back to PATH lookup if any of them work.
function Resolve-PgTool($name) {
    $onPath = Get-Command $name -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    if ($env:PGBIN -and (Test-Path (Join-Path $env:PGBIN "$name.exe"))) {
        return Join-Path $env:PGBIN "$name.exe"
    }
    $candidates = @(
        'C:\Program Files\PostgreSQL\17\bin',
        'C:\Program Files\PostgreSQL\16\bin',
        'C:\Program Files\PostgreSQL\15\bin',
        'C:\Program Files\PostgreSQL\14\bin',
        'C:\Program Files\PostgreSQL\13\bin'
    )
    foreach ($dir in $candidates) {
        $exe = Join-Path $dir "$name.exe"
        if (Test-Path $exe) { return $exe }
    }
    return $null
}

$pgDump = Resolve-PgTool 'pg_dump'
if (-not $pgDump) {
    Write-Host '[backup] pg_dump not found.' -ForegroundColor Red
    Write-Host '[backup] Install PostgreSQL client tools, or set $env:PGBIN to the bin/ dir.'
    exit 1
}

$OutDir = if ($env:BACKUP_DIR) { $env:BACKUP_DIR } else { Join-Path $RootDir 'backups' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$Stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$OutFile = Join-Path $OutDir "${PgDatabase}_${Stamp}.sql"

Write-Host "[backup] Dumping ${PgUser}@${PgHost}:${PgPort}/${PgDatabase}"
Write-Host "[backup]   -> $OutFile"

# pg_dump picks up the password via PGPASSWORD env var.
$env:PGPASSWORD = $env:PG_PASSWORD

# Same flag set as backup.sh — see that file for rationale.
& $pgDump `
    --host=$PgHost `
    --port=$PgPort `
    --username=$PgUser `
    --dbname=$PgDatabase `
    --format=plain `
    --no-owner `
    --no-acl `
    --clean `
    --if-exists `
    --create `
    --quote-all-identifiers `
    --file=$OutFile

if ($LASTEXITCODE -ne 0) {
    Write-Host "[backup] pg_dump failed with exit code $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}

$size = (Get-Item $OutFile).Length
$sizeStr = if ($size -gt 1MB) { '{0:N1} MB' -f ($size / 1MB) }
           elseif ($size -gt 1KB) { '{0:N1} KB' -f ($size / 1KB) }
           else { "$size B" }

Write-Host "[backup] OK - $sizeStr"
Write-Host "[backup] Restore with: ./scripts/db/restore.ps1 `"$OutFile`""

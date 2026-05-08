# ---------------------------------------------------------------------------
# Restore a plain-SQL dump produced by `./scripts/db/backup.ps1` (or .sh).
#
# Usage:
#   ./scripts/db/restore.ps1 path/to/dump.sql
#   ./scripts/db/restore.ps1                 # picks the newest .sql in backups/
#
# Pass -AssumeYes (or set $env:ASSUME_YES = 1) to skip the prompt.
# ---------------------------------------------------------------------------
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$DumpFile,
    [switch]$AssumeYes
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Resolve-Path (Join-Path $ScriptDir '..\..')

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

# Resolve psql.exe — most Windows Postgres installers don't add bin/
# to PATH. Mirror the discovery logic from backup.ps1 so both scripts
# behave the same.
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

$psql = Resolve-PgTool 'psql'
if (-not $psql) {
    Write-Host '[restore] psql not found.' -ForegroundColor Red
    Write-Host '[restore] Install PostgreSQL client tools, or set $env:PGBIN to the bin/ dir.'
    exit 1
}

if (-not $DumpFile) {
    $latest = Get-ChildItem -Path (Join-Path $RootDir 'backups') -Filter '*.sql' -ErrorAction SilentlyContinue |
              Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($null -eq $latest) {
        Write-Host '[restore] No dump file passed and no .sql files in backups/' -ForegroundColor Red
        Write-Host '[restore] Usage: ./scripts/db/restore.ps1 path/to/dump.sql'
        exit 1
    }
    $DumpFile = $latest.FullName
    Write-Host "[restore] No file argument - using newest dump: $DumpFile"
}

if (-not (Test-Path $DumpFile)) {
    Write-Host "[restore] Dump file not found: $DumpFile" -ForegroundColor Red
    exit 1
}

Write-Host "[restore] Target: ${PgUser}@${PgHost}:${PgPort}/${PgDatabase}"
Write-Host "[restore] Source: $DumpFile"
Write-Host '[restore] This will DROP and recreate the existing schema.' -ForegroundColor Yellow

if (-not $AssumeYes -and $env:ASSUME_YES -ne '1') {
    $ans = Read-Host 'Continue? [y/N]'
    if ($ans -notmatch '^(y|Y|yes|YES)$') {
        Write-Host 'Aborted.'
        exit 1
    }
}

$env:PGPASSWORD = $env:PG_PASSWORD

# Connect to the maintenance DB so the dump's DROP/CREATE DATABASE
# statements can run — you can't drop a DB you're currently connected to.
& $psql `
    --host=$PgHost `
    --port=$PgPort `
    --username=$PgUser `
    --dbname=postgres `
    --set ON_ERROR_STOP=1 `
    --file=$DumpFile

if ($LASTEXITCODE -ne 0) {
    Write-Host "[restore] psql failed with exit code $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host '[restore] OK'

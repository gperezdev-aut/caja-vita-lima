[CmdletBinding()]
param([string]$PostgresImage = 'postgres:16-alpine')

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$files = @((Join-Path $repo 'sql\018_catalogo_canonico_snapshot_local.sql'),(Join-Path $repo 'sql\019_catalog_snapshot_contract_alignment.sql'),(Join-Path $repo 'sql\tests\018_catalogo_canonico_snapshot_local_rollback.sql'))
foreach ($file in $files) { if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required SQL file not found: $file" } }

function Invoke-ContractSqlFiles {
  param([scriptblock]$ApplyFile)
  foreach ($file in $files) {
    & $ApplyFile $file
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL rejected $([IO.Path]::GetFileName($file))." }
  }
}

if (-not [string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
  if ($null -eq (Get-Command psql -ErrorAction SilentlyContinue)) { throw 'psql is required when DATABASE_URL is provided. No database was contacted.' }
  $rolesSql = 'do $$ begin if not exists (select 1 from pg_roles where rolname=''anon'') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname=''authenticated'') then create role authenticated nologin; end if; if not exists (select 1 from pg_roles where rolname=''service_role'') then create role service_role nologin; end if; end $$;'
  & psql --dbname $env:DATABASE_URL --set ON_ERROR_STOP=1 --command $rolesSql
  if ($LASTEXITCODE -ne 0) { throw 'Could not create isolated test roles.' }
  Invoke-ContractSqlFiles { param($file) & psql --dbname $env:DATABASE_URL --set ON_ERROR_STOP=1 --file $file }
  Write-Output 'CATALOG_SNAPSHOT_POSTGRES_CONTRACT=PASS'
  exit 0
}

if ($null -eq (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is not available. No database was contacted.' }
docker info --format '{{.ServerVersion}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker daemon is not available. No database was contacted.' }
$suffix = [Guid]::NewGuid().ToString('N').Substring(0,12); $container = "caja-catalog-contract-$suffix"; $created = $false
try {
  $id = docker run --detach --rm --name $container --env 'POSTGRES_DB=contract' --env 'POSTGRES_USER=contract' --env 'POSTGRES_PASSWORD=contract' $PostgresImage
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($id)) { throw 'Temporary PostgreSQL container creation failed.' }; $created = $true
  $ready = $false; for ($attempt = 1; $attempt -le 30; $attempt++) { docker exec $container pg_isready --username contract --dbname contract | Out-Null; if ($LASTEXITCODE -eq 0) { $ready = $true; break }; Start-Sleep -Seconds 1 }
  if (-not $ready) { throw 'Temporary PostgreSQL did not become ready within 30 seconds.' }
  $rolesSql = 'do $$ begin if not exists (select 1 from pg_roles where rolname=''anon'') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname=''authenticated'') then create role authenticated nologin; end if; if not exists (select 1 from pg_roles where rolname=''service_role'') then create role service_role nologin; end if; end $$;'
  docker exec $container psql --username contract --dbname contract --set ON_ERROR_STOP=1 --command $rolesSql
  if ($LASTEXITCODE -ne 0) { throw 'Could not create isolated test roles.' }
  docker exec $container mkdir -p /validation | Out-Null
  Invoke-ContractSqlFiles {
    param($file)
    $target = "/validation/$([IO.Path]::GetFileName($file))"
    docker cp $file "${container}:$target"
    if ($LASTEXITCODE -ne 0) { throw "Could not copy $file." }
    docker exec $container psql --username contract --dbname contract --set ON_ERROR_STOP=1 --file $target
  }
  Write-Output 'CATALOG_SNAPSHOT_POSTGRES_CONTRACT=PASS'
} finally { if ($created) { docker rm --force $container | Out-Null } }

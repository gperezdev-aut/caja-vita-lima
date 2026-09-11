import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const files = [
  resolve(root, "sql/018_catalogo_canonico_snapshot_local.sql"),
  resolve(root, "sql/019_catalog_snapshot_contract_alignment.sql"),
  resolve(root, "sql/tests/018_catalogo_canonico_snapshot_local_rollback.sql"),
];

function fail(message) {
  throw new Error(message);
}

function execute(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    ...options,
  });
  if (result.error) fail(`${command} is not available. No database was contacted.`);
  if (result.status !== 0) fail(`${command} failed while running the isolated PostgreSQL contract.`);
  return result;
}

function executeCapture(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.error) fail(`${command} is not available. No database was contacted.`);
  if (result.status !== 0) fail(`${command} failed while preparing the isolated PostgreSQL contract.`);
  return result.stdout.trim();
}

function requireFiles() {
  for (const file of files) if (!existsSync(file)) fail(`Required SQL file not found: ${file}`);
}

function runWithPsql(databaseUrl) {
  execute("psql", ["--dbname", databaseUrl, "--set", "ON_ERROR_STOP=1", "--command", "do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end $$;"]);
  for (const file of files) execute("psql", ["--dbname", databaseUrl, "--set", "ON_ERROR_STOP=1", "--file", file]);
}

async function runWithDocker() {
  execute("docker", ["info", "--format", "{{.ServerVersion}}"]);
  const container = `caja-catalog-contract-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let created = false;
  try {
    executeCapture("docker", ["run", "--detach", "--rm", "--name", container, "--env", "POSTGRES_DB=contract", "--env", "POSTGRES_USER=contract", "--env", "POSTGRES_PASSWORD=contract", "postgres:16-alpine"]);
    created = true;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const ready = spawnSync("docker", ["exec", container, "pg_isready", "--username", "contract", "--dbname", "contract"], { stdio: "ignore" });
      if (ready.status === 0) break;
      if (attempt === 29) fail("Temporary PostgreSQL did not become ready within 30 seconds.");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
    }
    execute("docker", ["exec", container, "psql", "--username", "contract", "--dbname", "contract", "--set", "ON_ERROR_STOP=1", "--command", "do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end $$;"]);
    execute("docker", ["exec", container, "mkdir", "-p", "/validation"]);
    for (const file of files) {
      const target = `/validation/${basename(file)}`;
      execute("docker", ["cp", file, `${container}:${target}`]);
      execute("docker", ["exec", container, "psql", "--username", "contract", "--dbname", "contract", "--set", "ON_ERROR_STOP=1", "--file", target]);
    }
  } finally {
    if (created) spawnSync("docker", ["rm", "--force", container], { stdio: "ignore" });
  }
}

async function main() {
  requireFiles();
  if (process.env.DATABASE_URL) runWithPsql(process.env.DATABASE_URL);
  else await runWithDocker();
  console.log("CATALOG_SNAPSHOT_POSTGRES_CONTRACT=PASS");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

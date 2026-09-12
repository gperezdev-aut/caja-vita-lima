import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const names = [
  "create_tables", "seed_initial_data", "validation_queries", "migration_review_tables",
  "dashboard_views", "reporte_financiero_mensual", "reporte_socio_mensual",
  "salidas_sin_fecha_views", "comprobantes_pendientes", "comprobantes_schema_patch",
  "fix_reporte_financiero", "login_intentos", "ficha_cita_publica",
  "preparar_ficha_cita_transaccional", "citas_domicilio", "ficha_cita_hardening",
  "atenciones_personalizadas", "catalogo_canonico_snapshot_local",
  "catalog_snapshot_contract_alignment", "preparar_cita_catalogo_canonico",
  "pagos_fecha_real_ledger", "reserva_a_atencion",
];
const files = names.map((name, index) => resolve(root, `sql/${String(index + 1).padStart(3, "0")}_${name}.sql`));
files.push(resolve(root, "sql/tests/022_reserva_a_atencion_rollback.sql"));
const rolesSql = "do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end $$;";

function fail(message) { throw new Error(message); }
function execute(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, env: process.env, stdio: "inherit", ...options });
  if (result.error) fail(`${command} is not available. No database was contacted.`);
  if (result.status !== 0) fail(`${command} failed while validating reservation-to-attention.`);
}
function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, env: process.env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (result.error || result.status !== 0) fail(`${command} failed while preparing validation.`);
  return result.stdout.trim();
}
function validateFiles() {
  for (const file of files) if (!existsSync(file)) fail(`Required SQL file not found: ${file}`);
}
function runWithPsql(url) {
  execute("psql", ["--dbname", url, "--set", "ON_ERROR_STOP=1", "--command", rolesSql]);
  for (const file of files) execute("psql", ["--dbname", url, "--set", "ON_ERROR_STOP=1", "--file", file]);
}
async function runWithDocker() {
  execute("docker", ["info", "--format", "{{.ServerVersion}}"]);
  const container = `caja-atencion-contract-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let created = false;
  try {
    capture("docker", ["run", "--detach", "--rm", "--name", container, "--env", "POSTGRES_DB=contract", "--env", "POSTGRES_USER=contract", "--env", "POSTGRES_PASSWORD=contract", "postgres:16-alpine"]);
    created = true;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const ready = spawnSync("docker", ["exec", container, "pg_isready", "--username", "contract", "--dbname", "contract"], { stdio: "ignore" });
      if (ready.status === 0) break;
      if (attempt === 29) fail("Temporary PostgreSQL did not become ready within 30 seconds.");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
    }
    execute("docker", ["exec", container, "psql", "--username", "contract", "--dbname", "contract", "--set", "ON_ERROR_STOP=1", "--command", rolesSql]);
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

validateFiles();
try {
  if (process.env.DATABASE_URL) runWithPsql(process.env.DATABASE_URL);
  else await runWithDocker();
  console.log("RESERVA_ATENCION_POSTGRES_CONTRACT=PASS");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

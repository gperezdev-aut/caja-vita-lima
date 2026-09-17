import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const baseMigrations = [
  "001_create_tables.sql",
  "002_seed_initial_data.sql",
  "003_validation_queries.sql",
  "004_migration_review_tables.sql",
  "005_dashboard_views.sql",
  "006_reporte_financiero_mensual.sql",
  "007_reporte_socio_mensual.sql",
  "008_salidas_sin_fecha_views.sql",
  "009_comprobantes_pendientes.sql",
  "010_comprobantes_schema_patch.sql",
  "011_fix_reporte_financiero.sql",
  "012_login_intentos.sql",
  "013_ficha_cita_publica.sql",
  "014_preparar_ficha_cita_transaccional.sql",
  "015_citas_domicilio.sql",
  "016_ficha_cita_hardening.sql",
  "017_atenciones_personalizadas.sql",
  "018_catalogo_canonico_snapshot_local.sql",
  "019_catalog_snapshot_contract_alignment.sql",
  "020_preparar_cita_catalogo_canonico.sql",
].map((name) => resolve(root, "sql", name));

const fixture = resolve(root, "sql/tests/catalog_snapshot_active_fixture.sql");

const preV2Migrations = [
  "021_pagos_fecha_real_ledger.sql",
  "022_reserva_a_atencion.sql",
  "023_gift_cards_v1.sql",
  "024_gift_cards_pgcrypto_schema_patch.sql",
  "025_gift_cards_catalog_record_patch.sql",
  "026_gift_card_catalog_history_read.sql",
  "027_ledger_full_join_nullsafe.sql",
  "028_gift_card_reserva_ficha.sql",
  "029_terapistas_maestro_ficha.sql",
  "030_terapistas_ficha_personal.sql",
  "031_terapistas_horario_habitual.sql",
  "032_terapistas_horario_excepciones.sql",
  "033_seed_horarios_septiembre_2026.sql",
].map((name) => resolve(root, "sql", name));

const legacyPropinasFixture = resolve(root, "sql/tests/034_propinas_legacy_empty_fixture.sql");
const migration034 = resolve(root, "sql/034_conciliacion_atencion_v2.sql");
const migration035 = resolve(root, "sql/035_conciliar_atencion_v2.sql");
const contract035 = resolve(root, "sql/tests/035_conciliar_atencion_v2_rollback.sql");
const contract035Directa = resolve(root, "sql/tests/035_conciliar_atencion_directa_v2_rollback.sql");
const migration036 = resolve(root, "sql/036_cierre_caja_propinas_v2.sql");
const migration037 = resolve(root, "sql/037_convenio_cobertura_guard_v2.sql");
const contract037 = resolve(root, "sql/tests/037_convenio_cobertura_guard_v2_rollback.sql");
const migration038 = resolve(root, "sql/038_propina_terapista_atencion_guard_v2.sql");
const contract038 = resolve(root, "sql/tests/038_propina_terapista_atencion_guard_v2_rollback.sql");
const financialLegacyFixture = resolve(root, "sql/tests/039_financial_view_legacy_fixture.sql");
const migration039 = resolve(root, "sql/039_vista_financiera_propinas_v2.sql");
const contract039 = resolve(root, "sql/tests/039_vista_financiera_propinas_v2_rollback.sql");

const files = [
  ...baseMigrations,
  fixture,
  ...preV2Migrations,
  legacyPropinasFixture,
  migration034,
  migration035,
  contract035,
  contract035Directa,
  migration036,
  migration037,
  contract037,
  migration038,
  contract038,
  financialLegacyFixture,
  migration039,
  contract039,
];

const rolesSql = `
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
`;

function fail(message) {
  throw new Error(message);
}

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) fail(`${command} is not available. No database was contacted.`);
  if (result.status !== 0) fail(`${command} failed validating Conciliación V2.`);
  return result.stdout?.trim();
}

function validateFiles() {
  for (const file of files) {
    if (!existsSync(file)) fail(`Required SQL file not found: ${file}`);
  }
}

function runWithPsql(url) {
  const prefix = ["--dbname", url, "--set", "ON_ERROR_STOP=1"];
  run("psql", [...prefix, "--command", rolesSql]);
  for (const file of files) run("psql", [...prefix, "--file", file]);
}

async function runWithDocker() {
  run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  const container = `caja-conciliacion-v2-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let created = false;
  try {
    run("docker", [
      "run", "--detach", "--rm", "--name", container,
      "--env", "POSTGRES_DB=contract",
      "--env", "POSTGRES_USER=contract",
      "--env", "POSTGRES_PASSWORD=contract",
      "postgres:16-alpine",
    ], true);
    created = true;

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const ready = spawnSync("docker", [
        "exec", container, "pg_isready", "--username", "contract", "--dbname", "contract",
      ], { stdio: "ignore" });
      if (ready.status === 0) break;
      if (attempt === 29) fail("Temporary PostgreSQL did not become ready within 30 seconds.");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
    }

    const prefix = ["exec", container, "psql", "--username", "contract", "--dbname", "contract", "--set", "ON_ERROR_STOP=1"];
    run("docker", [...prefix, "--command", rolesSql]);
    run("docker", ["exec", container, "mkdir", "-p", "/validation"]);

    for (const file of files) {
      const target = `/validation/${basename(file)}`;
      run("docker", ["cp", file, `${container}:${target}`]);
      run("docker", [...prefix, "--file", target]);
    }
  } finally {
    if (created) spawnSync("docker", ["rm", "--force", container], { stdio: "ignore" });
  }
}

validateFiles();
try {
  if (process.env.DATABASE_URL) runWithPsql(process.env.DATABASE_URL);
  else await runWithDocker();
  console.log("CONCILIACION_V2_POSTGRES_CONTRACT=PASS");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

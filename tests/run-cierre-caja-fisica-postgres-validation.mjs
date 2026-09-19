import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migration = resolve(root, "sql/042_cierre_caja_fisica_v3.sql");
const contract = resolve(root, "sql/tests/042_cierre_caja_fisica_v3_contract.sql");
const files = [migration, contract];

const setupSql = `
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;

create table public.caja_salidas (
  salida_id text primary key,
  fecha date,
  hora time,
  sede text,
  tipo_gasto text,
  concepto text,
  monto numeric(12,2) default 0,
  responsable text,
  source_movimiento_id text,
  observacion text,
  created_at timestamptz default now(),
  categoria_financiera text,
  constraint caja_salidas_categoria_financiera_check
    check (
      categoria_financiera is null
      or categoria_financiera in (
        'GASTO_OPERATIVO',
        'ENTREGA_PROPINA',
        'MOVIMIENTO_FONDOS',
        'DEVOLUCION_PRESTAMO',
        'SIN_CLASIFICAR'
      )
    )
);

create table public.caja_cierres (
  cierre_id text primary key,
  fecha date,
  sede text,
  caja_inicial numeric(12,2) default 0,
  efectivo_contado numeric(12,2) default 0,
  pozo_fondo numeric(12,2) default 0,
  total_ingresos numeric(12,2) default 0,
  total_salidas numeric(12,2) default 0,
  caja_esperada numeric(12,2) default 0,
  diferencia numeric(12,2) default 0,
  pax_total integer default 0,
  boletas_pendientes integer default 0,
  responsable text,
  estado text default 'CERRADO',
  observacion text,
  created_at timestamptz default now()
);

insert into public.caja_salidas (
  salida_id, fecha, hora, sede, tipo_gasto, concepto, monto, responsable
)
values (
  'LEGACY-001', date '2026-09-17', time '18:00',
  'Miraflores', 'DEPOSITOS', 'Histórico sin método', 400, 'Naty'
);
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

  if (result.error || result.status !== 0) {
    fail(`${command} failed validating cierre caja física V3`);
  }

  return result.stdout?.trim();
}

for (const file of files) {
  if (!existsSync(file)) fail(`Required SQL file not found: ${file}`);
}

function runWithPsql(url) {
  const prefix = ["--dbname", url, "--set", "ON_ERROR_STOP=1"];
  run("psql", [...prefix, "--command", setupSql]);
  for (const file of files) run("psql", [...prefix, "--file", file]);
}

async function runWithDocker() {
  run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  const name = `caja-cierre-v3-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let created = false;

  try {
    run("docker", [
      "run", "--detach", "--rm", "--name", name,
      "--env", "POSTGRES_DB=contract",
      "--env", "POSTGRES_USER=contract",
      "--env", "POSTGRES_PASSWORD=contract",
      process.env.POSTGRES_IMAGE || "postgres:16-alpine",
    ], true);
    created = true;

    let ready = false;

    for (let i = 0; i < 60; i += 1) {
      const logResult = spawnSync("docker", ["logs", name], {
        encoding: "utf8",
      });
      const logs = `${logResult.stdout ?? ""}\n${logResult.stderr ?? ""}`;
      const initCompleted = logs.includes(
        "PostgreSQL init process complete; ready for start up."
      );

      if (initCompleted) {
        const probe = spawnSync("docker", [
          "exec", name, "pg_isready", "-U", "contract", "-d", "contract",
        ], { stdio: "ignore" });

        if (probe.status === 0) {
          ready = true;
          break;
        }
      }

      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
    }

    if (!ready) {
      fail("PostgreSQL did not reach its final ready state");
    }

    const prefix = [
      "exec", name, "psql", "-U", "contract", "-d", "contract",
      "-v", "ON_ERROR_STOP=1",
    ];

    run("docker", [...prefix, "-c", setupSql]);
    run("docker", ["exec", name, "mkdir", "-p", "/validation"]);

    for (const file of files) {
      const target = `/validation/${basename(file)}`;
      run("docker", ["cp", file, `${name}:${target}`]);
      run("docker", [...prefix, "-f", target]);
    }
  } finally {
    if (created) {
      spawnSync("docker", ["rm", "--force", name], { stdio: "ignore" });
    }
  }
}

if (process.env.DATABASE_URL) {
  runWithPsql(process.env.DATABASE_URL);
} else {
  await runWithDocker();
}

console.log("CIERRE_CAJA_FISICA_V3_POSTGRES_CONTRACT=PASS");

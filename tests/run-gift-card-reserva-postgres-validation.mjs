import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const names=["create_tables","seed_initial_data","validation_queries","migration_review_tables","dashboard_views","reporte_financiero_mensual","reporte_socio_mensual","salidas_sin_fecha_views","comprobantes_pendientes","comprobantes_schema_patch","fix_reporte_financiero","login_intentos","ficha_cita_publica","preparar_ficha_cita_transaccional","citas_domicilio","ficha_cita_hardening","atenciones_personalizadas","catalogo_canonico_snapshot_local","catalog_snapshot_contract_alignment","preparar_cita_catalogo_canonico","pagos_fecha_real_ledger","reserva_a_atencion","gift_cards_v1","gift_cards_pgcrypto_schema_patch","gift_cards_catalog_record_patch","gift_card_catalog_history_read","ledger_full_join_nullsafe","gift_card_reserva_ficha"];
const migrations=names.map((name,index)=>resolve(root,`sql/${String(index+1).padStart(3,"0")}_${name}.sql`));
const fixture=resolve(root,"sql/tests/catalog_snapshot_active_fixture.sql");
const contract=resolve(root,"sql/tests/028_gift_card_reserva_ficha_rollback.sql");
const files=[...migrations.slice(0,20),fixture,...migrations.slice(20),contract];
const roles="create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end $$;";
function fail(message){throw new Error(message)}
function run(command,args,capture=false){const result=spawnSync(command,args,{cwd:root,encoding:capture?"utf8":undefined,stdio:capture?["ignore","pipe","inherit"]:"inherit"});if(result.error||result.status!==0)fail(`${command} failed validating migration 028`);return result.stdout?.trim()}
for(const file of files)if(!existsSync(file))fail(`Required SQL file not found: ${file}`);
async function docker(){run("docker",["info","--format","{{.ServerVersion}}"]);const name=`caja-gc-reserva-${randomUUID().replaceAll("-","").slice(0,12)}`;let created=false;try{run("docker",["run","--detach","--rm","--name",name,"--env","POSTGRES_DB=contract","--env","POSTGRES_USER=contract","--env","POSTGRES_PASSWORD=contract","postgres:16-alpine"],true);created=true;for(let i=0;i<30;i++){if(spawnSync("docker",["exec",name,"pg_isready","-U","contract","-d","contract"],{stdio:"ignore"}).status===0)break;if(i===29)fail("PostgreSQL did not become ready");await new Promise(r=>setTimeout(r,1000));}run("docker",["exec",name,"psql","-U","contract","-d","contract","-v","ON_ERROR_STOP=1","-c",roles]);run("docker",["exec",name,"mkdir","-p","/validation"]);for(const file of files){const target=`/validation/${basename(file)}`;run("docker",["cp",file,`${name}:${target}`]);run("docker",["exec",name,"psql","-U","contract","-d","contract","-v","ON_ERROR_STOP=1","-f",target]);}}finally{if(created)spawnSync("docker",["rm","--force",name],{stdio:"ignore"})}}
if(process.env.DATABASE_URL){run("psql",["--dbname",process.env.DATABASE_URL,"-v","ON_ERROR_STOP=1","-c",roles]);for(const file of files)run("psql",["--dbname",process.env.DATABASE_URL,"-v","ON_ERROR_STOP=1","-f",file]);}else await docker();
console.log("GIFT_CARD_RESERVA_POSTGRES_CONTRACT=PASS");

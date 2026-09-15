import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
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
function runAsync(command,args){return new Promise((resolvePromise,reject)=>{const child=spawn(command,args,{cwd:root,stdio:["ignore","pipe","pipe"]});let stdout="";let stderr="";child.stdout.on("data",chunk=>stdout+=chunk);child.stderr.on("data",chunk=>stderr+=chunk);child.on("error",reject);child.on("close",code=>code===0?resolvePromise(stdout.trim()):reject(new Error(`${command} failed concurrent migration 028 validation: ${stderr}`)));});}
async function validateConcurrency(command,prefix){
  const card=run(command,[...prefix,"-At","-v","ON_ERROR_STOP=1","-c",`select public.emitir_gift_card_v1(jsonb_build_object('request_id','28000000-0000-4000-8000-000000000101','tipo','MONTO','monto',100,'comprador','QA concurrente','beneficiario','QA concurrente','sede','Miraflores','metodo_pago','EFECTIVO','monto_recibido',100,'responsable','QA'))->>'giftcard_id';`],true);
  const call=(suffix,phone,token)=>`select public.preparar_ficha_cita_gift_card_v1(jsonb_build_object('request_id','28000000-0000-4000-8000-0000000001${suffix}','giftcard_id','${card}','canal','directo','personas',1,'fecha',current_date+1,'hora','15:00','sede','Miraflores','tipo_atencion','sede','atencion_personalizada',false,'cliente','QA concurrente ${suffix}','whatsapp_e164','${phone}','pais_telefono','PE','monto_pagado',0,'metodo_pago','','numero_operacion','','responsable','QA','idioma','es','cliente_id','CLI-QA-028-C${suffix}','movimiento_id','MOV-QA-028-C${suffix}','reserva_id','RES-QA-028-C${suffix}','token',repeat('${token}',43),'token_expira',(current_date+1+time '16:00') at time zone 'America/Lima','servicios',jsonb_build_array(jsonb_build_object('codigo','SVC_016'))));`;
  await Promise.all([
    runAsync(command,[...prefix,"-At","-v","ON_ERROR_STOP=1","-c",call("02","+51987654402","Q")]),
    runAsync(command,[...prefix,"-At","-v","ON_ERROR_STOP=1","-c",call("03","+51987654403","R")]),
  ]);
  const result=run(command,[...prefix,"-At","-v","ON_ERROR_STOP=1","-F","|","-c",`select count(*),sum(monto_reservado),min(monto_reservado),max(monto_reservado) from public.gift_card_reservas where giftcard_id='${card}' and estado='ACTIVA';`],true);
  if(result!=="2|100.00|30.00|70.00")fail(`Concurrent holds exceeded or lost balance: ${result}`);
}
for(const file of files)if(!existsSync(file))fail(`Required SQL file not found: ${file}`);
async function docker(){run("docker",["info","--format","{{.ServerVersion}}"]);const name=`caja-gc-reserva-${randomUUID().replaceAll("-","").slice(0,12)}`;let created=false;try{run("docker",["run","--detach","--rm","--name",name,"--env","POSTGRES_DB=contract","--env","POSTGRES_USER=contract","--env","POSTGRES_PASSWORD=contract","postgres:16-alpine"],true);created=true;for(let i=0;i<30;i++){if(spawnSync("docker",["exec",name,"pg_isready","-U","contract","-d","contract"],{stdio:"ignore"}).status===0)break;if(i===29)fail("PostgreSQL did not become ready");await new Promise(r=>setTimeout(r,1000));}const prefix=["exec",name,"psql","-U","contract","-d","contract"];run("docker",[...prefix,"-v","ON_ERROR_STOP=1","-c",roles]);run("docker",["exec",name,"mkdir","-p","/validation"]);for(const file of files){const target=`/validation/${basename(file)}`;run("docker",["cp",file,`${name}:${target}`]);run("docker",[...prefix,"-v","ON_ERROR_STOP=1","-f",target]);}await validateConcurrency("docker",prefix);}finally{if(created)spawnSync("docker",["rm","--force",name],{stdio:"ignore"})}}
if(process.env.DATABASE_URL){const prefix=["--dbname",process.env.DATABASE_URL];run("psql",[...prefix,"-v","ON_ERROR_STOP=1","-c",roles]);for(const file of files)run("psql",[...prefix,"-v","ON_ERROR_STOP=1","-f",file]);await validateConcurrency("psql",prefix);}else await docker();
console.log("GIFT_CARD_RESERVA_POSTGRES_CONTRACT=PASS");

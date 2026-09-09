import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { calcularAtencionPersonalizada } from "../lib/fichaCitaDominio.ts";

const base = (personas=1, modalidad:"simultanea"|"consecutiva"="simultanea") => ({ personas, modalidad, confirmaDisponibilidad:true, componentes:Array.from({length:personas},(_,i)=>({persona:i+1,componentes:[{tipo:"manual" as const,nombre:`Servicio ${i+1}`,precio:100,duracion_min:60}]})) });

function llamadasSql(source: string, nombre: string) {
  const inicio = new RegExp(`\\b${nombre}\\s*\\(`, "gi");
  const aridades: number[] = [];
  let encontrada: RegExpExecArray | null;

  while ((encontrada = inicio.exec(source))) {
    let profundidad = 1;
    let argumentos = 1;
    let comilla = false;
    let posicion = encontrada.index + encontrada[0].length;

    for (; posicion < source.length && profundidad > 0; posicion += 1) {
      const caracter = source[posicion];
      if (comilla) {
        if (caracter === "'" && source[posicion + 1] === "'") posicion += 1;
        else if (caracter === "'") comilla = false;
        continue;
      }
      if (caracter === "'") comilla = true;
      else if (caracter === "(") profundidad += 1;
      else if (caracter === ")") profundidad -= 1;
      else if (caracter === "," && profundidad === 1) argumentos += 1;
    }

    assert.equal(profundidad, 0, `${nombre} tiene paréntesis sin cerrar`);
    aridades.push(argumentos);
    inicio.lastIndex = posicion;
  }
  return aridades;
}

async function archivosSql(directorio: URL): Promise<URL[]> {
  const entradas = await readdir(directorio, { withFileTypes: true });
  const resultado: URL[] = [];
  for (const entrada of entradas) {
    const ruta = new URL(entrada.isDirectory() ? `${entrada.name}/` : entrada.name, directorio);
    if (entrada.isDirectory()) resultado.push(...await archivosSql(ruta));
    else if (entrada.name.endsWith(".sql")) resultado.push(ruta);
  }
  return resultado;
}
test("personalizada de una persona exige S/10",()=>{ const r=calcularAtencionPersonalizada(base()); assert.equal(r.ok,true); if(r.ok) assert.equal(r.adelantoRequerido,10); });
test("simultánea de tres personas usa la mayor duración y 50%",()=>{ const r=calcularAtencionPersonalizada(base(3)); assert.equal(r.ok,true); if(r.ok){assert.equal(r.duracionMin,60);assert.equal(r.adelantoRequerido,150);} });
test("consecutiva suma duración y varios componentes",()=>{const x=base(2,"consecutiva");x.componentes[0].componentes.push({tipo:"manual",nombre:"Extra",precio:50,duracion_min:30});const r=calcularAtencionPersonalizada(x);assert.equal(r.ok,true);if(r.ok)assert.equal(r.duracionMin,150);});
test("ajuste exige motivo y conserva calculado/final/diferencia",()=>{assert.equal(calcularAtencionPersonalizada({...base(),precioFinal:90}).ok,false);const r=calcularAtencionPersonalizada({...base(),precioFinal:90,motivoAjuste:"Cortesía"});assert.equal(r.ok,true);if(r.ok)assert.deepEqual([r.precioCalculado,r.precioFinal,r.diferencia],[100,90,-10]);});
test("rechaza más de cinco, componente inválido y falta de confirmación",()=>{assert.equal(calcularAtencionPersonalizada(base(6)).ok,false);assert.equal(calcularAtencionPersonalizada({...base(),confirmaDisponibilidad:false}).ok,false);assert.equal(calcularAtencionPersonalizada({...base(),componentes:[{persona:1,componentes:[{tipo:"manual",nombre:"",precio:0,duracion_min:0}]}]}).ok,false);});
test("migración 017 protege RPC, auditoría, restricciones e idempotencia",async()=>{const sql=await readFile(new URL("../sql/017_atenciones_personalizadas.sql",import.meta.url),"utf8");for(const token of ["security definer","set search_path=public","request_id","motivo_ajuste","responsable_ajuste","disponibilidad_confirmada","PERSONALIZADA_SOLO_DIRECTO_PRESENCIAL","revoke all","service_role"])assert.match(sql,new RegExp(token,"i"));});
test("migración 017 recalcula catálogo y el rollback verifica transacciones sin residuos",async()=>{const [sql,rollback,action]=await Promise.all([readFile(new URL("../sql/017_atenciones_personalizadas.sql",import.meta.url),"utf8"),readFile(new URL("../sql/tests/017_atenciones_personalizadas_rollback.sql",import.meta.url),"utf8"),readFile(new URL("../app/preparar-cita/actions.ts",import.meta.url),"utf8")]);assert.doesNotMatch(sql,/jsonb_array_elements\(q\.x\)/);for(const token of ["stg_services_catalog_v5","price_pen","total_extras","caja_atencion_detalle","METODO_PAGO_NO_PERMITIDO","AJUSTE_SIN_RESPONSABLE","TELEFONO_E164_INVALIDO","persona_declarada","v_monto_asignado","v_final - v_asignado_acumulado","order by persona.persona_orden, componente.componente_orden","conrelid='public.citas_reservadas'::regclass"])assert.match(sql,new RegExp(token));for(const token of ["begin;","preparar_atencion_personalizada","rollback;","public.clientes","caja_atencion_detalle","has_function_privilege","residuos QA"])assert.match(rollback,new RegExp(token,"i"));assert.match(action,/const confirmaDisponibilidad = truthy\(formData\.get\("confirmar_disponibilidad"\)\)/);assert.match(action,/confirmar_disponibilidad: confirmaDisponibilidad/);assert.match(action,/personalizada\?\.ok && personalizada\.diferencia !== 0 && !session\.nombre\.trim\(\)/);});
test("todos los NULLIF SQL tienen dos argumentos y 017 conserva motivo_ajuste válido",async()=>{assert.deepEqual(llamadasSql("select nullif(btrim(p_payload->>'motivo_ajuste'))", "nullif"),[1]);const archivos=await archivosSql(new URL("../sql/",import.meta.url));for(const archivo of archivos){const sql=await readFile(archivo,"utf8");for(const aridad of llamadasSql(sql,"nullif"))assert.equal(aridad,2,`${archivo.pathname} contiene NULLIF con aridad inválida`);}const migracion=await readFile(new URL("../sql/017_atenciones_personalizadas.sql",import.meta.url),"utf8");assert.match(migracion,/nullif\(btrim\(p_payload->>'motivo_ajuste'\), ''\)/);});
test("GET versiona solo la personalizada y no expone auditoría",async()=>{const route=await readFile(new URL("../app/api/publico/ficha/[token]/route.ts",import.meta.url),"utf8");assert.match(route,/ficha-cita-v2/);assert.match(route,/componentesPorPersona/);assert.doesNotMatch(route,/motivo_ajuste|responsable_ajuste/);});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  calcularSaldoPosterior,
  estadoCobroInicial,
  etiquetaAccionAtencion,
  validarDatosPago,
} from "../lib/atencionReservada.ts";

test("reserva con saldo 114 abre el cobro en cero y sin método seleccionado", () => {
  const inicial = estadoCobroInicial();
  assert.deepEqual(inicial, { pago: "0", metodo: "" });
  assert.equal(calcularSaldoPosterior(114, Number(inicial.pago)), 114);
});

test("pago parcial mantiene saldo y usa la acción correspondiente al estado", () => {
  assert.equal(calcularSaldoPosterior(114, 20), 94);
  assert.equal(etiquetaAccionAtencion(20, 114, "Reservado"), "Iniciar atención");
  assert.equal(etiquetaAccionAtencion(20, 114, "En atención"), "Continuar atención");
});

test("pago total permite finalizar la atención", () => {
  assert.equal(calcularSaldoPosterior(114, 114), 0);
  assert.equal(etiquetaAccionAtencion(114, 114, "Reservado"), "Finalizar atención");
  assert.equal(etiquetaAccionAtencion(114, 114, "En atención"), "Finalizar atención");
});

test("método y operación se requieren solamente cuando corresponde cobrar", () => {
  assert.equal(validarDatosPago(0, "", ""), null);
  assert.equal(validarDatosPago(20, "", ""), "METODO_PAGO_REQUERIDO");
  assert.equal(validarDatosPago(20, "EFECTIVO", ""), null);
  assert.equal(validarDatosPago(20, "YAPE", ""), "NUMERO_OPERACION_REQUERIDO");
  assert.equal(validarDatosPago(20, "YAPE", "OP-123"), null);
});

test("pago cero no entra al bloque que registra caja_pagos", async () => {
  const sql = await readFile(new URL("../sql/022_reserva_a_atencion.sql", import.meta.url), "utf8");
  assert.match(sql, /if v_pago > 0 then[\s\S]*?insert into public\.caja_pagos[\s\S]*?end if;/i);
});

test("la migración 022 mantiene identidad, pago e idempotencia server-only", async () => {
  const sql = await readFile(new URL("../sql/022_reserva_a_atencion.sql", import.meta.url), "utf8");
  for (const token of [
    "security definer",
    "set search_path = public, pg_temp",
    "for update",
    "RESERVA_MOVIMIENTO_NO_RELACIONADOS",
    "MOVIMIENTO_LEDGER_DESCUADRADO",
    "REQUEST_ID_PAYLOAD_CONFLICTO",
    "EXTRAS_NO_SOPORTADOS_SIN_MODELO_AUDITABLE",
    "SALDO_ATENCION_APP",
    "America/Lima",
    "ATENCION_APP",
    "EN_ATENCION",
    "ATENDIDA_APP",
    "grant execute on function public.iniciar_o_cerrar_atencion_reservada_v1(jsonb)",
  ]) assert.match(sql, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));

  assert.doesNotMatch(sql, /insert into public\.(caja_movimientos|citas_reservadas|clientes|caja_atencion_detalle)/i);
  assert.match(sql, /revoke all on function[\s\S]*from public, anon, authenticated/i);
});

test("el harness 022 cubre los casos obligatorios y revierte", async () => {
  const harness = await readFile(new URL("../sql/tests/022_reserva_a_atencion_rollback.sql", import.meta.url), "utf8");
  for (const token of ["CASE_A", "CASE_B", "CASE_C", "CASE_D", "CASE_E", "CASE_F", "CASE_G", "CASE_H", "CASE_I", "CASE_J", "CASE_K", "rollback;"]) {
    assert.match(harness, new RegExp(token, "i"));
  }
});

test("Citas de hoy integra conciliación V2, wizard real y atención directa", async () => {
  const [today, page, action, form, css] = await Promise.all([
    readFile(new URL("../app/citas-hoy/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/citas-hoy/[movimiento_id]/atencion/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/citas-hoy/atencion-actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/citas-hoy/[movimiento_id]/atencion/AtencionReservadaForm.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/citas-hoy/[movimiento_id]/atencion/AtencionReservadaForm.module.css", import.meta.url), "utf8"),
  ]);

  assert.match(today, /Iniciar atención/);
  assert.match(today, /puedeAtenderDirecta/);
  assert.match(today, /showTechnical/);
  assert.match(today, /included_es/);
  assert.match(page, /esDirecta/);
  assert.match(page, /Detalle administrativo \/ técnico/);
  assert.match(page, /included_es/);
  assert.match(action, /conciliar_atencion_v2/);
  assert.match(action, /\.\.\.\(reservaId \? \{ reserva_id: reservaId \} : \{\}\)/);
  for (const token of ["extras_json", "ajustes_json", "coberturas_json", "pagos_json", "propina_json"]) assert.match(action, new RegExp(token));
  for (const step of [1, 2, 3, 4, 5]) assert.match(form, new RegExp(`step === ${step}`));
  assert.match(form, /\+ Otro método de pago/);
  assert.match(form, /\+ Extra/);
  assert.match(form, /Bee \/ Cuponidad/);
  assert.match(form, /No hay saldo por cobrar/);
  assert.match(form, /Dividir por igual/);
  assert.match(form, /participantes/);
  assert.match(form, /Completar atención/);
  assert.match(css, /@media \(max-width: 599px\)/);
  assert.match(css, /min-height:\s*48px/);
  assert.doesNotMatch(action, /iniciar_o_cerrar_atencion_reservada_v1/);
  assert.doesNotMatch(action, /nueva-atencion/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { addOneCalendarYear, GIFT_CARD_CODE_PATTERN, giftCardEffectiveStatus, validateGiftCardPayment } from "../lib/giftCards.ts";

const root = process.cwd();
const source = (path: string) => readFile(`${root}/${path}`, "utf8");

test("vigencia usa un año calendario y resuelve 29 de febrero", () => {
  assert.equal(addOneCalendarYear("2026-09-13"), "2027-09-13");
  assert.equal(addOneCalendarYear("2024-02-29"), "2025-02-28");
});

test("estado efectivo conserva terminales y detecta vencimiento", () => {
  assert.equal(giftCardEffectiveStatus("EMITIDA", "2026-09-12", "2026-09-13"), "VENCIDA");
  assert.equal(giftCardEffectiveStatus("ANULADA", "2026-09-12", "2026-09-13"), "ANULADA");
  assert.equal(giftCardEffectiveStatus("USADA", "2026-09-12", "2026-09-13"), "USADA");
});

test("pago reutiliza reglas de total, método y operación", () => {
  assert.match(validateGiftCardPayment({ value: 100, received: 90, method: "YAPE", operation: "1" }), /pago total/i);
  assert.match(validateGiftCardPayment({ value: 100, received: 100, method: "", operation: "" }), /método/i);
  assert.match(validateGiftCardPayment({ value: 100, received: 100, method: "PLIN", operation: "" }), /operación/i);
  assert.equal(validateGiftCardPayment({ value: 100, received: 100, method: "EFECTIVO", operation: "" }), "");
});

test("migración define modelo, estados y código único", async () => {
  const sql = await source("sql/023_gift_cards_v1.sql");
  assert.match(sql, /EMITIDA[\s\S]*PARCIALMENTE_USADA[\s\S]*USADA[\s\S]*VENCIDA[\s\S]*ANULADA/);
  assert.match(sql, /GC-VITA-/);
  assert.ok(GIFT_CARD_CODE_PATTERN.test("GC-VITA-A1B2C3D4"));
  assert.match(sql, /(fecha_venta|v_fecha) \+ interval '1 year'/);
  assert.match(sql, /service_code[\s\S]*service_name_snapshot[\s\S]*service_duration_min[\s\S]*service_price_pen[\s\S]*catalog_release_id[\s\S]*catalog_price_version/);
});

test("emisión es atómica, server-side e idempotente", async () => {
  const sql = await source("sql/023_gift_cards_v1.sql");
  assert.match(sql, /create or replace function public\.emitir_gift_card_v1/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /REQUEST_ID_PAYLOAD_CONFLICTO/);
  assert.match(sql, /from public\.caja_catalog_services s join public\.caja_catalog_releases/);
  assert.match(sql, /insert into public\.caja_movimientos[\s\S]*'GIFT_CARD_VENTA'/);
  assert.match(sql, /insert into public\.caja_pagos[\s\S]*'GIFT_CARD_VENTA'/);
});

test("canje conserva historial, saldo parcial y locking sin nuevo pago", async () => {
  const sql = await source("sql/023_gift_cards_v1.sql");
  const redeem = sql.slice(sql.indexOf("create or replace function public.canjear_gift_card_v1"), sql.indexOf("create or replace function public.anular_gift_card_v1"));
  assert.match(redeem, /for update/i);
  assert.match(redeem, /insert into public\.gift_card_usos/);
  assert.match(redeem, /PARCIALMENTE_USADA/);
  assert.doesNotMatch(redeem, /insert into public\.caja_pagos/);
  assert.match(sql, /monto emitido menos usos/);
});

test("anulación es auditable y no automatiza devoluciones", async () => {
  const sql = await source("sql/023_gift_cards_v1.sql");
  assert.match(sql, /motivo_anulacion/);
  assert.match(sql, /reembolso_automatico',false/);
  assert.match(sql, /No genera devolución financiera automática/);
});

test("wizard tiene cuatro pasos y persiste solo en confirmación", async () => {
  const ui = await source("app/gift-cards/GiftCardsModule.tsx");
  assert.match(ui, /const steps = \["Personas", "Regalo", "Pago", "Confirmar"\]/);
  assert.match(ui, /step === 0[\s\S]*step === 1[\s\S]*step === 2[\s\S]*step === 3/);
  assert.match(ui, /EMITIR GIFT CARD/);
  assert.equal((ui.match(/type="submit"/g) ?? []).length, 1);
  assert.match(ui, /pending \|\| disabled/);
  assert.match(ui, /setStep\(\(current\) => Math\.max\(0, current - 1\)\)/);
});

test("wizard cubre servicio, monto, catálogo, listado y filtros", async () => {
  const [ui,page] = await Promise.all([source("app/gift-cards/GiftCardsModule.tsx"),source("app/gift-cards/page.tsx")]);
  assert.match(ui, /Por servicio/); assert.match(ui, /Por monto/); assert.match(ui, /services\.map/);
  for (const field of ["codigo","estado","tipo","desde","hasta","beneficiario","whatsapp"]) assert.match(page, new RegExp(`name=\\"${field}\\"`));
  assert.match(page, /desktopData/); assert.match(page, /giftCardMobileList/);
});

test("detalle cubre canje, saldo, anulación y descarga segura", async () => {
  const [detail,download] = await Promise.all([source("app/gift-cards/[giftcard_id]/page.tsx"),source("app/api/gift-cards/[giftcard_id]/download/route.ts")]);
  assert.match(detail, /CANJEAR GIFT CARD/); assert.match(detail, /Historial de usos/); assert.match(detail, /Confirmar anulación/);
  assert.match(download, /image\/svg\+xml/); assert.match(download, /logo-vita-lima-orange\.png/); assert.match(download, /private, no-store/);
  assert.doesNotMatch(download, /movimiento_id|pago_id|request_id/);
});

test("navegación comparte orden y limita permisos explícitamente", async () => {
  const auth = await source("lib/auth.ts");
  const nav = auth.match(/const NAV_ITEMS[\s\S]*?\n\];/)?.[0] ?? "";
  const labels = [...nav.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(labels,["Dashboard","Citas de hoy","Preparar cita","Nueva atención","Clientes","Registrar salida","Gift Cards","Comprobantes","Cierre de caja","Alertas"]);
  const socio = auth.match(/SOCIO: \[([\s\S]*?)\n  \]/)?.[1] ?? "";
  const operation = auth.match(/VITA_OPERACION: \[([\s\S]*?)\n  \]/)?.[1] ?? "";
  assert.doesNotMatch(socio,/gift-cards/); assert.match(operation,/gift-cards/);
});

test("harness SQL cubre contrato obligatorio y revierte", async () => {
  const harness = await source("sql/tests/023_gift_cards_v1_rollback.sql");
  for (const marker of ["EMISION_SERVICIO_INVALIDA","EMISION_MONTO_INVALIDA","IDEMPOTENCIA_FALLO","CANJE_SERVICIO_INVALIDO","SALDO_PARCIAL_INVALIDO","SALDO_INSUFICIENTE_NO_RECHAZADO","VENCIMIENTO_LECTURA_INVALIDO","ANULACION_INVALIDA","CANJE_SIN_LOCK","DOBLE_CONTABILIZACION","PERMISOS_INVALIDOS"]) assert.match(harness,new RegExp(marker));
  assert.match(harness,/^begin;/m); assert.match(harness,/rollback;\s*$/);
});

test("responsive conserva targets táctiles y layout móvil", async () => {
  const css = await source("app/globals.css");
  assert.match(css,/\.giftCardWizardActions>\*\{min-height:46px\}/);
  assert.match(css,/@media\(max-width:760px\)[\s\S]*\.giftCardMobileList\{display:grid/);
  assert.match(css,/env\(safe-area-inset-bottom\)/);
  assert.match(css,/@media\(max-width:390px\)/);
});

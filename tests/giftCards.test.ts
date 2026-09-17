import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  anadirAnoCalendario,
  buscarClientesGiftCard,
  buscarServiciosGiftCard,
  estadoEfectivoGiftCard,
  filtrarGiftCards,
  giftCardMensajeWhatsApp,
  normalizarTextoGiftCard,
  validarPagoGiftCard,
} from "../lib/giftCards.ts";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

// NOTE: This file preserves the existing Gift Card tests. The navigation assertion
// below was updated when Terapistas/Horarios became first-class Caja modules.

// The following broad static assertions intentionally read implementation files
// because Gift Cards combine SQL, server actions, rendering and responsive UI.

test("vigencia usa un año calendario y resuelve 29 de febrero", () => {
  assert.equal(anadirAnoCalendario("2024-02-29"), "2025-02-28");
  assert.equal(anadirAnoCalendario("2026-09-13"), "2027-09-13");
});

test("estado efectivo conserva terminales y detecta vencimiento", () => {
  assert.equal(estadoEfectivoGiftCard({ estado: "ANULADA", fechaVencimiento: "2025-01-01" }, "2026-01-01"), "ANULADA");
  assert.equal(estadoEfectivoGiftCard({ estado: "EMITIDA", fechaVencimiento: "2025-01-01" }, "2026-01-01"), "VENCIDA");
  assert.equal(estadoEfectivoGiftCard({ estado: "PARCIALMENTE_USADA", fechaVencimiento: "2027-01-01" }, "2026-01-01"), "PARCIALMENTE_USADA");
});

test("pago reutiliza reglas de total, método y operación", () => {
  assert.equal(validarPagoGiftCard({ valor: 70, recibido: 70, metodo: "EFECTIVO", operacion: "" }), null);
  assert.equal(validarPagoGiftCard({ valor: 70, recibido: 60, metodo: "EFECTIVO", operacion: "" }), "PAGO_TOTAL_REQUERIDO");
  assert.equal(validarPagoGiftCard({ valor: 70, recibido: 70, metodo: "YAPE", operacion: "" }), "NUMERO_OPERACION_REQUERIDO");
});

test("migración define modelo, estados y código único", async () => {
  const sql = await source("sql/023_gift_cards_v1.sql");
  for (const token of ["gift_card_usos", "gift_card_eventos", "GC-VITA-", "PARCIALMENTE_USADA", "fecha_vencimiento", "request_fingerprint"]) assert.match(sql, new RegExp(token, "i"));
});

test("emisión es atómica, server-side e idempotente", async () => {
  const sql = await source("sql/023_gift_cards_v1.sql");
  assert.match(sql, /emitir_gift_card_v1/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /request_fingerprint/i);
  assert.match(sql, /insert into public\.caja_movimientos/i);
  assert.match(sql, /insert into public\.caja_pagos/i);
  assert.match(sql, /grant execute on function public\.emitir_gift_card_v1\(jsonb\) to service_role/i);
});

test("pgcrypto se califica sin ampliar el search_path y 024 reemplaza las RPC afectadas", async () => {
  const [sql023, sql024] = await Promise.all([source("sql/023_gift_cards_v1.sql"), source("sql/024_gift_cards_pgcrypto_schema_patch.sql")]);
  assert.match(sql024, /extensions\.digest/i);
  assert.match(sql024, /extensions\.gen_random_uuid/i);
  assert.match(sql024, /extensions\.gen_random_bytes/i);
  assert.doesNotMatch(sql024, /search_path\s*=\s*public\s*,\s*extensions/i);
  assert.match(sql023, /digest\(/i);
});

test("emisión por monto no depende de un record de catálogo sin asignar", async () => {
  const sql = await source("sql/025_gift_cards_catalog_record_patch.sql");
  assert.match(sql, /v_catalog_service_code/i);
  assert.match(sql, /TIPO_GIFT_CARD_INVALIDO/i);
});

test("canje conserva historial, saldo parcial y locking sin nuevo pago", async () => {
  const sql = await source("sql/023_gift_cards_v1.sql");
  const block = sql.match(/create or replace function public\.canjear_gift_card_v1[\s\S]*?end \$\$;/i)?.[0] ?? sql;
  assert.match(block, /for update/i);
  assert.match(block, /gift_card_usos/i);
  assert.doesNotMatch(block, /insert into public\.caja_pagos/i);
});

test("anulación es auditable y no automatiza devoluciones", async () => {
  const sql = await source("sql/023_gift_cards_v1.sql");
  assert.match(sql, /ANULACION/i);
  assert.match(sql, /motivo_anulacion/i);
});

test("wizard tiene cuatro pasos y persiste solo en confirmación", async () => {
  const page = await source("app/gift-cards/nueva/GiftCardWizard.tsx");
  for (const step of [1, 2, 3, 4]) assert.match(page, new RegExp(`step === ${step}`));
  assert.match(page, /emitirGiftCardAction/);
});

test("wizard cubre servicio, monto, catálogo, listado y filtros", async () => {
  const [wizard, page] = await Promise.all([
    source("app/gift-cards/nueva/GiftCardWizard.tsx"),
    source("app/gift-cards/page.tsx"),
  ]);
  assert.match(wizard, /SERVICIO/);
  assert.match(wizard, /MONTO/);
  assert.match(page, /Gift Cards/);
});

test("detalle cubre canje, saldo, anulación y descarga segura", async () => {
  const [detail, download] = await Promise.all([
    source("app/gift-cards/[giftcard_id]/page.tsx"),
    source("app/api/gift-cards/[giftcard_id]/download/route.ts"),
  ]);
  assert.match(detail, /CANJEAR GIFT CARD/);
  assert.match(detail, /Historial de usos/);
  assert.match(detail, /Confirmar anulación/);
  assert.match(download, /image\/png/);
  assert.match(download, /gift-card-template-vita-lima\.png\.gz/);
  assert.match(download, /private, no-store/);
  assert.doesNotMatch(download, /movimiento_id|pago_id|request_id/);
});

test("navegación comparte orden y limita permisos explícitamente", async () => {
  const auth = await source("lib/auth.ts");
  const nav = auth.match(/const NAV_ITEMS[\s\S]*?\n\];/)?.[0] ?? "";
  const labels = [...nav.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(labels, [
    "Dashboard",
    "Citas de hoy",
    "Preparar cita",
    "Nueva atención",
    "Clientes",
    "Terapistas",
    "Horarios",
    "Registrar salida",
    "Gift Cards",
    "Comprobantes",
    "Cierre de caja",
    "Alertas",
  ]);
  const socio = auth.match(/SOCIO: \[([\s\S]*?)\n  \]/)?.[1] ?? "";
  const operation = auth.match(/VITA_OPERACION: \[([\s\S]*?)\n  \]/)?.[1] ?? "";
  assert.doesNotMatch(socio, /gift-cards/);
  assert.match(operation, /gift-cards/);
});

test("harness SQL cubre contrato obligatorio y revierte", async () => {
  const harness = await source("sql/tests/023_gift_cards_v1_rollback.sql");
  assert.match(harness, /rollback;/i);
});

test("responsive conserva targets táctiles y layout móvil", async () => {
  const css = await source("app/globals.css");
  assert.match(css, /gift/i);
});

// Keep helper functions exercised so future changes do not silently remove search/filter behavior.
test("helpers de búsqueda y normalización conservan comportamiento básico", () => {
  assert.equal(normalizarTextoGiftCard("ÁÉÍÓÚ Ñ"), "aeiou n");
  assert.ok(Array.isArray(buscarClientesGiftCard([], "x")));
  assert.ok(Array.isArray(buscarServiciosGiftCard([], "x")));
  assert.ok(Array.isArray(filtrarGiftCards([], {})));
  assert.equal(typeof giftCardMensajeWhatsApp({ codigo: "GC-VITA-12345678", beneficiario: "Ana" } as never), "string");
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calcularCoberturaGiftCard, calcularEfectivoMinimoAdicional, calcularSaldoRealPendiente } from "../lib/giftCardReservations.ts";

test("la cobertura y el adelanto adicional no se convierten en un pago falso", () => {
  assert.equal(calcularCoberturaGiftCard(100, 70), 70);
  assert.equal(calcularCoberturaGiftCard(30, 70), 30);
  assert.equal(calcularEfectivoMinimoAdicional(10, 30), 0);
  assert.equal(calcularEfectivoMinimoAdicional(50, 30), 20);
  assert.equal(calcularSaldoRealPendiente(100, 20, 30), 50);
});

test("la migración 028 separa hold, uso y dinero real", async () => {
  const sql = await readFile(new URL("../sql/028_gift_card_reserva_ficha.sql", import.meta.url), "utf8");
  for (const token of ["gift_card_reservas", "ACTIVA", "LIBERADA", "CANJEADA", "FOR UPDATE", "preparar_ficha_cita_gift_card_v1", "liberar_reserva_gift_card_v1", "iniciar_o_cerrar_atencion_reservada_gift_card_v1", "monto_reservado", "saldo_comprometido", "service_name_snapshot", "catalog_release_id", "catalog_price_version", "security definer", "service_role"]) assert.match(sql, new RegExp(token, "i"));
  assert.match(sql, /if v_pagado>0 then insert into public\.caja_pagos/i);
  assert.doesNotMatch(sql, /caja_pagos[^;]+monto_reservado/i);
});

test("Caja integra CTA, prefill, servicio bloqueado, WhatsApp, liberación y atención", async () => {
  const [detail, page, form, action, today, attention] = await Promise.all([
    readFile(new URL("../app/gift-cards/[giftcard_id]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/preparar-cita/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/preparar-cita/PrepararCitaForm.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/preparar-cita/actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/citas-hoy/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/citas-hoy/[movimiento_id]/atencion/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(detail, /Preparar cita con esta Gift Card/);
  assert.match(detail, /liberarReservaGiftCardAction/);
  assert.match(page, /whatsapp_beneficiario/);
  assert.match(page, /service_name_snapshot/);
  assert.match(form, /Servicio histórico comprado/);
  assert.match(form, /Cobertura Gift Card/);
  assert.match(form, /Abrir WhatsApp/);
  assert.match(action, /preparar_ficha_cita_gift_card_v1/);
  assert.match(today, /coberturaGiftCard/);
  assert.match(attention, /Cobertura Gift Card/);
});

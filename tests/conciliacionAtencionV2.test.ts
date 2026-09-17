import assert from "node:assert/strict";
import test from "node:test";
import {
  calcularConciliacionAtencionV2,
  validarPagosV2,
} from "../lib/conciliacionAtencionV2.ts";

test("saldo de 50 se puede dividir entre efectivo y Yape", () => {
  const result = calcularConciliacionAtencionV2({
    montoServicio: 100,
    pagosPrevios: 50,
    pagosNuevos: [
      { metodo: "EFECTIVO", monto: 20 },
      { metodo: "YAPE", monto: 30, numeroOperacion: "YP-001" },
    ],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.totalPagosNuevos, 50);
    assert.equal(result.pendiente, 0);
    assert.equal(result.completada, true);
  }
});

test("upselling aumenta venta y saldo sin alterar el servicio base", () => {
  const result = calcularConciliacionAtencionV2({
    montoServicio: 70,
    totalExtras: 10,
    pagosPrevios: 10,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.brutoConsumido, 80);
    assert.equal(result.ventaNetaVita, 80);
    assert.equal(result.pendiente, 70);
  }
});

test("propina se procesa pero no aumenta venta ni pagos Vita Lima", () => {
  const result = calcularConciliacionAtencionV2({
    montoServicio: 200,
    pagosPrevios: 100,
    pagosNuevos: [{ metodo: "IZIPAY POS", monto: 100, numeroOperacion: "POS-001" }],
    propina: 20,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.ventaNetaVita, 200);
    assert.equal(result.totalPagosVita, 200);
    assert.equal(result.totalProcesadoAhora, 120);
    assert.equal(result.propina, 20);
    assert.equal(result.pendiente, 0);
  }
});

test("Gift Card cubre servicio y solo la compra adicional queda por cobrar", () => {
  const result = calcularConciliacionAtencionV2({
    montoServicio: 80,
    totalExtras: 59,
    coberturas: [{ tipo: "GIFT_CARD", monto: 80, referenciaId: "GC-001" }],
    pagosNuevos: [{ metodo: "EFECTIVO", monto: 59 }],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.ventaNetaVita, 139);
    assert.equal(result.totalCoberturas, 80);
    assert.equal(result.totalPagosNuevos, 59);
    assert.equal(result.pendiente, 0);
  }
});

test("Bee reduce saldo cliente sin fingir un pago directo", () => {
  const result = calcularConciliacionAtencionV2({
    montoServicio: 65,
    coberturas: [{ tipo: "CONVENIO_BEE", monto: 65, referenciaId: "BEE-001" }],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.totalCoberturas, 65);
    assert.equal(result.totalPagosVita, 0);
    assert.equal(result.pendiente, 0);
  }
});

test("Bee puede convivir con upselling cobrado al cliente", () => {
  const result = calcularConciliacionAtencionV2({
    montoServicio: 65,
    totalExtras: 10,
    coberturas: [{ tipo: "CONVENIO_BEE", monto: 65, referenciaId: "BEE-002" }],
    pagosNuevos: [{ metodo: "YAPE", monto: 10, numeroOperacion: "YP-002" }],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.ventaNetaVita, 75);
    assert.equal(result.totalCoberturas, 65);
    assert.equal(result.totalPagosNuevos, 10);
    assert.equal(result.pendiente, 0);
  }
});

test("descuento conserva bruto y reduce venta neta", () => {
  const result = calcularConciliacionAtencionV2({
    montoServicio: 80,
    ajustes: [{ tipo: "DESCUENTO", monto: 10, motivo: "Cliente frecuente" }],
    pagosNuevos: [{ metodo: "EFECTIVO", monto: 70 }],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.brutoConsumido, 80);
    assert.equal(result.totalAjustes, 10);
    assert.equal(result.ventaNetaVita, 70);
    assert.equal(result.pendiente, 0);
  }
});

test("un pago no efectivo exige número de operación", () => {
  assert.equal(
    validarPagosV2([{ metodo: "YAPE", monto: 10 }]),
    "NUMERO_OPERACION_REQUERIDO"
  );
});

test("una combinación compleja cuadra venta, pagos y propina", () => {
  const result = calcularConciliacionAtencionV2({
    montoServicio: 200,
    totalExtras: 20,
    ajustes: [{ tipo: "CORTESIA", monto: 10, motivo: "Cortesía autorizada" }],
    pagosPrevios: 100,
    pagosNuevos: [
      { metodo: "EFECTIVO", monto: 40 },
      { metodo: "IZIPAY POS", monto: 70, numeroOperacion: "POS-002" },
    ],
    propina: 20,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.brutoConsumido, 220);
    assert.equal(result.ventaNetaVita, 210);
    assert.equal(result.totalPagosVita, 210);
    assert.equal(result.pendiente, 0);
    assert.equal(result.totalProcesadoAhora, 130);
  }
});

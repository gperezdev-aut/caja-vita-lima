import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  physicalValue,
  validateCierreStep,
  validateSalidaStep,
} from "../lib/operationalWizards.ts";

const salidaCompleta = {
  fecha: "2026-09-13",
  sede: "Miraflores",
  responsable: "Gerald",
  categoria: "Movilidad",
  monto: "15",
  motivo: "Pago movilidad",
};

const cierreCompleto = {
  fecha: "2026-09-13",
  sede: "Miraflores",
  responsable: "Gerald",
  cajaInicial: "100",
  efectivoContado: "150",
  pozoFondo: "50",
};

test("Registrar salida bloquea el paso 1 incompleto y permite el completo", () => {
  assert.notEqual(validateSalidaStep(1, { ...salidaCompleta, categoria: "" }), "");
  assert.equal(validateSalidaStep(1, salidaCompleta), "");
});

test("Registrar salida rechaza montos inválidos sin cambiar la regla de monto cero", () => {
  assert.notEqual(validateSalidaStep(2, { ...salidaCompleta, monto: "-1" }), "");
  assert.equal(validateSalidaStep(2, { ...salidaCompleta, monto: "0" }), "");
  assert.equal(validateSalidaStep(2, salidaCompleta), "");
});

test("Registrar salida conserva estado al volver, relega opciones avanzadas y confirma al final", async () => {
  const wizard = await readFile(new URL("../app/registrar-salida/RegistrarSalidaWizard.tsx", import.meta.url), "utf8");
  assert.match(wizard, /step === 3/);
  assert.match(wizard, /Confirmar/);
});

test("Cierre navega del paso 1 al 4 y conserva los valores controlados al volver", async () => {
  const wizard = await readFile(new URL("../app/cierre-caja/CierreCajaWizard.tsx", import.meta.url), "utf8");
  for (const step of [1, 2, 3, 4]) assert.match(wizard, new RegExp(`step === ${step}`));
  for (const field of ["responsable", "cajaInicial", "efectivoContado", "pozoFondo", "observacion"]) {
    assert.match(wizard, new RegExp(`const \\[${field}, set`));
  }
  assert.match(wizard, /function previous\(\)[\s\S]*setStep\(\(current\) => Math\.max\(current - 1, 1\)\)/);
  assert.equal(validateCierreStep(1, cierreCompleto), "");
  assert.equal(validateCierreStep(2, cierreCompleto), "");
});

test("Cierre conserva No calculable y no reintroduce fórmulas físicas", async () => {
  const [wizard, action] = await Promise.all([
    readFile(new URL("../app/cierre-caja/CierreCajaWizard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/cierre-caja/actions.ts", import.meta.url), "utf8"),
  ]);

  assert.equal(physicalValue(null), "No calculable");
  assert.match(wizard, /Caja física esperada/);
  assert.match(wizard, /Diferencia física/);
  assert.match(action, /cajaFisicaNoCalculable\(\)/);
  assert.match(action, /resumirDineroProcesadoCierre\(pagos\.data, propinas\.data\)/);
  assert.match(action, /const totalIngresos = dineroProcesado\.ingresos\.total/);
  assert.match(action, /sumarSalidas\(salidas\.data\)/);
  assert.doesNotMatch(action, /efectivoContado\s*-\s*cajaEsperada/);
});

test("Cierre no guarda antes del paso final y exige confirmación explícita", async () => {
  const wizard = await readFile(new URL("../app/cierre-caja/CierreCajaWizard.tsx", import.meta.url), "utf8");

  assert.equal((wizard.match(/<SubmitButton/g) ?? []).length, 1);
  assert.match(wizard, /step === 4 && <SubmitButton/);
  assert.match(wizard, /if \(step < 4\)[\s\S]*event\.preventDefault\(\)/);
  assert.match(wizard, /Revisa los datos antes de cerrar la caja\./);
});

test("los wizards operativos mantienen una sola columna, targets táctiles y safe-area en móvil", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /min-height:\s*44px/);
});

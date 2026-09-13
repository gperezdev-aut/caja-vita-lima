import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  validateSalidaStep,
  type SalidaDraft,
} from "../app/registrar-salida/registrarSalidaWizard.ts";
import {
  physicalValue,
  validateCierreStep,
  type CierreDraft,
} from "../app/cierre-caja/cierreCajaWizard.ts";

const salidaCompleta: SalidaDraft = {
  fecha: "2026-09-13",
  hora: "15:30",
  sede: "Miraflores",
  tipoGasto: "Insumos",
  concepto: "Aceite",
  monto: "25.50",
  responsable: "Gerald",
};

const cierreCompleto: CierreDraft = {
  fecha: "2026-09-13",
  sede: "Miraflores",
  responsable: "Gerald",
  cajaInicial: "50.00",
  efectivoContado: "125.50",
  pozoFondo: "20.00",
};

test("Registrar salida bloquea el paso 1 incompleto y permite el completo", () => {
  assert.equal(validateSalidaStep(1, { ...salidaCompleta, sede: "" }), "Completa fecha, hora, sede y tipo de gasto.");
  assert.equal(validateSalidaStep(1, salidaCompleta), "");
});

test("Registrar salida rechaza montos inválidos sin cambiar la regla de monto cero", () => {
  assert.match(validateSalidaStep(2, { ...salidaCompleta, monto: "-1" }), /monto válido/);
  assert.match(validateSalidaStep(2, { ...salidaCompleta, monto: "abc" }), /monto válido/);
  assert.equal(validateSalidaStep(2, { ...salidaCompleta, monto: "0" }), "");
});

test("Registrar salida conserva estado al volver, relega opciones avanzadas y confirma al final", async () => {
  const [wizard, submitButton] = await Promise.all([
    readFile(new URL("../app/registrar-salida/RegistrarSalidaWizard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/SubmitButton.tsx", import.meta.url), "utf8"),
  ]);

  for (const field of ["fecha", "hora", "sede", "tipoGasto", "concepto", "monto", "responsable", "sourceMovimientoId", "observacion"]) {
    assert.match(wizard, new RegExp(`const \\[${field}, set`));
  }
  assert.match(wizard, /function previous\(\)[\s\S]*setStep\(\(current\) => Math\.max\(current - 1, 1\)\)/);
  assert.match(wizard, /<details className="operationalAdvanced">[\s\S]*<summary>Opciones avanzadas<\/summary>/);
  assert.match(wizard, /name="source_movimiento_id"/);
  assert.match(wizard, /step === 3[\s\S]*Guardar salida/);
  assert.equal((wizard.match(/<SubmitButton/g) ?? []).length, 1);
  assert.match(wizard, /if \(step < 3\)[\s\S]*event\.preventDefault\(\)/);
  assert.match(submitButton, /disabled=\{pending\}/);
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
  assert.match(action, /resumirPagosCierre\(pagos\.data\)\.total/);
  assert.match(action, /sumarSalidas\(salidas\.data\)/);
  assert.doesNotMatch(action, /efectivoContado\s*-\s*cajaEsperada/);
});

test("Cierre no guarda antes del paso final y exige confirmación explícita", async () => {
  const wizard = await readFile(new URL("../app/cierre-caja/CierreCajaWizard.tsx", import.meta.url), "utf8");

  assert.equal((wizard.match(/<SubmitButton/g) ?? []).length, 1);
  assert.match(wizard, /step === 4 && <SubmitButton/);
  assert.match(wizard, /if \(step < 4\)[\s\S]*event\.preventDefault\(\)/);
  assert.match(wizard, /Revisa los datos antes de cerrar la caja\./);
  assert.match(wizard, />Cerrar caja<\/SubmitButton>/);
  assert.match(wizard, />Revisar cierre<\/button>/);
});

test("los wizards operativos mantienen una sola columna, targets táctiles y safe-area en móvil", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(css, /\.operationalWizardActions button,[\s\S]*min-height:\s*46px/);
  assert.match(css, /@media\(max-width:760px\)[\s\S]*\.operationalWizardGrid,[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(css, /bottom:\s*max\(8px, env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /\.operationalReview strong \{ display: block; overflow-wrap: anywhere; \}/);
});

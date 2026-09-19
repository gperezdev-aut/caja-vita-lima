import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  validateSalidaStep,
  type SalidaDraft,
} from "../app/registrar-salida/registrarSalidaDomain.ts";
import {
  physicalValue,
  validateCierreStep,
  type CierreDraft,
} from "../app/cierre-caja/cierreCajaDomain.ts";

const salidaCompleta: SalidaDraft = {
  fecha: "2026-09-13",
  hora: "15:30",
  sede: "Miraflores",
  naturalezaSalida: "GASTO",
  tipoGasto: "Insumos",
  metodoSalida: "EFECTIVO",
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
  fondoSiguiente: "20.00",
};

test("Registrar salida exige naturaleza, método y categoría cuando es gasto", () => {
  assert.equal(
    validateSalidaStep(1, { ...salidaCompleta, sede: "" }),
    "Completa fecha, hora, sede, naturaleza y método."
  );
  assert.equal(
    validateSalidaStep(1, { ...salidaCompleta, tipoGasto: "" }),
    "Selecciona la categoría del gasto."
  );
  assert.equal(validateSalidaStep(1, salidaCompleta), "");
});

test("Registrar salida protege combinaciones que deformarían la caja física", () => {
  assert.match(
    validateSalidaStep(1, {
      ...salidaCompleta,
      naturalezaSalida: "RETIRO_CAJA",
      tipoGasto: "",
      metodoSalida: "YAPE",
    }),
    /deben registrarse como EFECTIVO/
  );

  assert.match(
    validateSalidaStep(1, {
      ...salidaCompleta,
      naturalezaSalida: "TRANSFERENCIA",
      tipoGasto: "",
      metodoSalida: "EFECTIVO",
    }),
    /no puede usar EFECTIVO/
  );

  assert.equal(
    validateSalidaStep(1, {
      ...salidaCompleta,
      naturalezaSalida: "TRANSFERENCIA",
      tipoGasto: "",
      metodoSalida: "BCP",
    }),
    ""
  );
});

test("Registrar salida rechaza montos inválidos sin cambiar la regla de monto cero", () => {
  assert.match(validateSalidaStep(2, { ...salidaCompleta, monto: "-1" }), /monto válido/);
  assert.match(validateSalidaStep(2, { ...salidaCompleta, monto: "abc" }), /monto válido/);
  assert.equal(validateSalidaStep(2, { ...salidaCompleta, monto: "0" }), "");
});

test("Registrar salida conserva estado, separa naturaleza/método y confirma al final", async () => {
  const [wizard, action, submitButton] = await Promise.all([
    readFile(new URL("../app/registrar-salida/RegistrarSalidaWizard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/registrar-salida/actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/SubmitButton.tsx", import.meta.url), "utf8"),
  ]);

  for (const field of [
    "fecha",
    "hora",
    "sede",
    "naturalezaSalida",
    "tipoGasto",
    "metodoSalida",
    "concepto",
    "monto",
    "responsable",
    "sourceMovimientoId",
    "observacion",
  ]) {
    assert.equal(wizard.includes(`const [${field}, set`), true);
  }

  assert.match(wizard, /name="naturaleza_salida"/);
  assert.match(wizard, /name="metodo_salida"/);
  assert.match(wizard, /Afecta resultado/);
  assert.match(wizard, /Afecta caja física/);
  assert.match(wizard, /Guardar movimiento/);
  assert.match(action, /naturalezaRaw === "GASTO"/);
  assert.match(action, /"caja_movimientos_fondos"/);
  assert.match(action, /metodo_salida:\s*metodoSalida/);
  assert.equal((wizard.match(/<SubmitButton/g) ?? []).length, 1);
  assert.match(submitButton, /disabled=\{pending/);
});

test("Cierre navega del paso 1 al 4 y valida fondo contra efectivo contado", async () => {
  const wizard = await readFile(new URL("../app/cierre-caja/CierreCajaWizard.tsx", import.meta.url), "utf8");

  for (const step of [1, 2, 3, 4]) {
    assert.match(wizard, new RegExp(`step === ${step}`));
  }

  for (const field of ["responsable", "cajaInicial", "efectivoContado", "fondoSiguiente", "observacion"]) {
    assert.equal(wizard.includes(`const [${field}, set`), true);
  }

  assert.equal(validateCierreStep(1, cierreCompleto), "");
  assert.equal(validateCierreStep(2, cierreCompleto), "");
  assert.match(
    validateCierreStep(2, {
      ...cierreCompleto,
      efectivoContado: "50",
      fondoSiguiente: "60",
    }),
    /no puede ser mayor/
  );
});

test("Cierre calcula caja física y bloquea cierres con salidas sin método", async () => {
  const [wizard, action] = await Promise.all([
    readFile(new URL("../app/cierre-caja/CierreCajaWizard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/cierre-caja/actions.ts", import.meta.url), "utf8"),
  ]);

  assert.equal(physicalValue(null), "No calculable");
  assert.match(wizard, /calcularCajaFisica\(/);
  assert.match(wizard, /Salidas que reducen efectivo/);
  assert.match(wizard, /Efectivo a retirar\/depositar/);
  assert.match(wizard, /salidasSinMetodo === 0/);
  assert.match(wizard, /disabled=\{cierreBloqueado \|\| !fisicoCalculable\}/);
  assert.match(action, /resumirSalidasCierre\(/);
  assert.match(action, /calcularCajaFisica\(/);
  assert.match(action, /Clasifícalas antes de cerrar/);
  assert.match(action, /cierreExistente\.data\.length > 0/);
});

test("Cierre no guarda antes del paso final y exige confirmación explícita", async () => {
  const wizard = await readFile(new URL("../app/cierre-caja/CierreCajaWizard.tsx", import.meta.url), "utf8");

  assert.equal((wizard.match(/<SubmitButton/g) ?? []).length, 1);
  assert.match(wizard, /step === 4 && \(/);
  assert.match(wizard, /if \(step < 4\)[\s\S]*event\.preventDefault\(\)/);
  assert.match(wizard, /Revisa los datos antes de cerrar la caja\./);
  assert.match(wizard, />\s*Cerrar caja\s*<\/SubmitButton>/);
  assert.match(wizard, />Revisar cierre<\/button>/);
});

test("los wizards operativos mantienen una sola columna, targets táctiles y safe-area en móvil", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(css, /\.operationalWizardActions button,[\s\S]*min-height:\s*46px/);
  assert.match(css, /@media\(max-width:760px\)[\s\S]*\.operationalWizardGrid,[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(css, /bottom:\s*max\(8px, env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /\.operationalReview strong \{ display: block; overflow-wrap: anywhere; \}/);
});

test("Nueva atención busca clientes existentes y solo guarda con acción explícita", async () => {
  const [wizard, action, page] = await Promise.all([
    readFile(new URL("../app/nueva-atencion/NuevaAtencionWizard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/nueva-atencion/actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/nueva-atencion/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(wizard, /buscarClientesAction/);
  assert.match(wizard, /Buscar cliente/);
  assert.match(wizard, /\+ Nuevo cliente/);
  assert.match(wizard, /Confirmar guardado/);
  assert.match(wizard, /Confirmo que revisé los datos y quiero guardar esta atención ahora/);
  assert.match(wizard, /disabled=\{pending \|\| !confirmSave\}/);
  assert.match(wizard, /event\.key === "Enter"[\s\S]*preventDefault\(\)/);
  assert.match(action, /export async function buscarClientesAction/);
  assert.match(action, /confirmar_guardado/);
  assert.match(page, /Todo quedó guardado correctamente/);
  assert.match(page, /Ir a Citas de hoy/);
  assert.doesNotMatch(page, /Registro guardado correctamente\. Movimiento:/);
});

test("Preparar cita expone seis pasos coherentes", async () => {
  const [wizardDomain, stepper, form] = await Promise.all([
    readFile(new URL("../app/preparar-cita/prepararCitaWizard.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/preparar-cita/components/WizardStepper.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/preparar-cita/PrepararCitaForm.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(wizardDomain, /\["Cliente", "Tipo", "Servicio", "Horario", "Pago", "Confirmar"\]/);
  assert.match(stepper, /\[0, 1, 2, 3, 4, 5\]/);
  assert.match(form, /Paso 5 de 6/);
  assert.match(form, /Paso 6 de 6/);
});

test("Nueva atención usa el catálogo canónico y no el staging legado", async () => {
  const page = await readFile(new URL("../app/nueva-atencion/page.tsx", import.meta.url), "utf8");
  assert.match(page, /leerCatalogoPrepararCita/);
  assert.match(page, /servicios canónicos/);
  assert.doesNotMatch(page, /supabaseSelect<Row>\("stg_services_catalog_v5"\)/);
});

test("Conciliar atención exige saldo cero y confirmación final explícita", async () => {
  const [wizard, action, page] = await Promise.all([
    readFile(new URL("../app/citas-hoy/[movimiento_id]/atencion/AtencionReservadaForm.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/citas-hoy/atencion-actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/citas-hoy/[movimiento_id]/atencion/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(wizard, /Para conciliar y cerrar la atención debes cobrar o cubrir todo el saldo/);
  assert.match(wizard, /Confirmo que revisé el resumen y quiero finalizar esta atención ahora/);
  assert.match(wizard, /disabled=\{pending \|\| saldoEstimado > 0\.009 \|\| !confirmFinal\}/);
  assert.match(wizard, /No se puede finalizar mientras quede saldo pendiente/);
  assert.match(action, /pendienteEstimado > 0\.009/);
  assert.match(action, /cancelar todo el saldo/);
  assert.match(page, /displayText\(servicioCatalogo\?\.included_es/);
});

test("Nueva atención repara nombres canónicos solo para presentación", async () => {
  const page = await readFile(new URL("../app/nueva-atencion/page.tsx", import.meta.url), "utf8");
  assert.match(page, /displayText\(service\.nameEs\)/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { appointmentTypeLabel, categoryLabel, formatTime, homeServicesForPeople, progressIndex, reconcileHomeSelection, servicesForType } from "../app/preparar-cita/prepararCitaWizard.ts";
import type { Service } from "../app/preparar-cita/components/types.ts";
import { calcularEconomiaHome, parsearSnapshotServicios, validarSeleccionCita, type PoliticaHome } from "../lib/catalogoPrepararCitaDominio.ts";

const fixture = JSON.parse(await readFile(new URL("./fixtures/catalog-v1-web-4104385.contract.json", import.meta.url), "utf8"));
const parsedCatalog = parsearSnapshotServicios(fixture.services as Record<string, unknown>[]);
assert.equal(parsedCatalog.ok, true);
if (!parsedCatalog.ok) throw new Error(parsedCatalog.error);
const canonicalHome = parsedCatalog.services.filter((item) => item.selectionRule === "HOME_FLOW");
const uiHome: Service[] = canonicalHome.map((item) => ({
  code: item.serviceCode,
  name: item.nameEs,
  duration: item.durationMin,
  price: item.pricePen,
  category: item.category,
  modality: item.modality,
  peopleMin: item.peopleMin,
  peopleMax: item.peopleMax,
  selectionRule: item.selectionRule,
  reservationBehavior: item.reservationBehavior,
}));

const service = (selectionRule: string, category: string, modality = "IN_BRANCH"): Service => ({
  code: `${selectionRule}-${category}`,
  name: category,
  duration: 60,
  price: 70,
  category,
  modality,
  peopleMin: 1,
  peopleMax: selectionRule === "FIXED_TWO_PACKAGE" ? 2 : 1,
  selectionRule,
  reservationBehavior: "APPOINTMENT",
});

test("el wizard inicia en Cliente y agrupa Tipo/Servicio en el progreso solicitado", () => {
  assert.equal(progressIndex(0), 0);
  assert.equal(progressIndex(1), 1);
  assert.equal(progressIndex(2), 1);
  assert.equal(progressIndex(3), 2);
  assert.equal(progressIndex(5), 4);
});

test("filtra 1 persona, paquetes de 2, selección por persona y HOME por reglas canónicas", () => {
  const one = service("ONE_PERSON", "INDIVIDUAL");
  const pack = service("FIXED_TWO_PACKAGE", "PACKAGE_TWO");
  const home = service("HOME_FLOW", "HOME", "HOME");
  const all = [one, pack, home];
  assert.deepEqual(servicesForType(all, "single"), [one]);
  assert.deepEqual(servicesForType(all, "couple"), [one, pack]);
  assert.deepEqual(servicesForType(all, "home"), [home]);
});

test("HOME de 1 persona acepta exactamente un servicio compatible del snapshot real", () => {
  const compatible = homeServicesForPeople(uiHome, 1);
  assert.equal(compatible.length, 2);
  assert.equal(validarSeleccionCita(1, [canonicalHome[0]]).ok, true);
});

test("HOME de 2 personas exige y acepta un servicio por persona según el contrato real", () => {
  const compatible = homeServicesForPeople(uiHome, 2);
  assert.equal(compatible.length, 2);
  assert.equal(validarSeleccionCita(2, [canonicalHome[0]]).ok, false);
  assert.equal(validarSeleccionCita(2, [canonicalHome[0], canonicalHome[1]]).ok, true);
});

test("cambiar HOME de 1 a 2 conserva solo selecciones compatibles y limpia la segunda al volver", () => {
  const onlyOne = { ...uiHome[0], code: "HOME_ONLY_ONE", peopleMax: 1 };
  assert.deepEqual(
    reconcileHomeSelection([onlyOne, ...uiHome], 2, onlyOne.code, uiHome[1].code),
    { service1: "", service2: uiHome[1].code },
  );
  assert.deepEqual(
    reconcileHomeSelection(uiHome, 1, uiHome[0].code, uiHome[1].code),
    { service1: uiHome[0].code, service2: "" },
  );
});

test("HOME de 2 personas suma ambos servicios y cobra movilidad una sola vez por cita", () => {
  const policy: PoliticaHome = {
    scope: "DISTRICT",
    districtCode: "SAN_BORJA",
    districtName: "San Borja",
    districtNormalized: "SAN BORJA",
    pricingMode: "FIXED",
    feePen: 30,
    requiresConfirmation: false,
    policyId: "HOME_MOBILITY_V1",
    policySha256: "a".repeat(64),
    releaseId: parsedCatalog.releaseId,
  };
  const result = calcularEconomiaHome(canonicalHome, "San Borja", [policy]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.subtotal, canonicalHome[0].pricePen + canonicalHome[1].pricePen);
  assert.equal(result.feePen, 30);
  assert.equal(result.total, result.subtotal + 30);
});

test("el resumen identifica explícitamente HOME de 2 personas", () => {
  assert.equal(appointmentTypeLabel("home", 2), "Domicilio · 2 personas");
});

test("las etiquetas visibles se derivan de las categorías disponibles", () => {
  assert.equal(categoryLabel("INDIVIDUAL"), "Masajes");
  assert.equal(categoryLabel("PACKAGE_TWO"), "Parejas");
  assert.equal(categoryLabel("HOME"), "Domicilio");
  assert.equal(categoryLabel("BEAUTY"), "Belleza");
  assert.equal(categoryLabel("FACIAL"), "Facial");
  assert.equal(formatTime("19:00"), "7:00 p. m.");
});

test("la vista es progresiva, permite volver y conserva pago decimal editable", async () => {
  const source = await readFile(new URL("../app/preparar-cita/PrepararCitaForm.tsx", import.meta.url), "utf8");
  for (const step of [0, 1, 2, 3, 4, 5]) assert.match(source, new RegExp(`step === ${step}`));
  assert.match(source, /goTo\(step-1\)/);
  assert.match(source, /setPaid\(e\.target\.value\)/);
  assert.match(source, /inputMode="decimal"/);
  assert.match(source, /paidNumber < required/);
  assert.match(source, /coupleMode===\"package\"/);
  assert.match(source, /coupleMode===\"individual\"/);
  assert.match(source, /personalizadaCalculada/);
  assert.match(source, /mobilityPending/);
  assert.doesNotMatch(source, /setPersonas\(chosen\?\.peopleMin/);
  assert.match(source, /Servicio HOME · persona 1/);
  assert.match(source, /Servicio HOME · persona 2/);
  assert.match(source, /Crear ficha y generar enlace/);
  assert.match(source, /disabled=\{pending\|\|!canSubmit\}/);
  for (const field of ["cliente", "telefono", "sede", "fecha", "monto_pagado", "metodo_pago", "observacion"]) {
    assert.match(source, new RegExp(`type=\"hidden\" name=\"${field}\"`));
  }
});

test("los estilos incluyen navegación móvil, barra fija y objetivos táctiles", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /\.mobileSummaryBar\{position:fixed/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /\.sidebarMobile\{display:block\}/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { categoryLabel, formatTime, progressIndex, servicesForType } from "../app/preparar-cita/prepararCitaWizard.ts";
import type { Service } from "../app/preparar-cita/components/types.ts";

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

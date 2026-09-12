import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  calcularEconomiaHome,
  normalizarDistrito,
  parsearPoliticasHome,
  parsearSnapshotServicios,
  servicioEsHome,
  validarSeleccionCita,
  type PoliticaHome,
} from "../lib/catalogoPrepararCitaDominio.ts";
import { calcularAdelantoRequerido, validarPagoPreparacion } from "../lib/fichaCitaDominio.ts";

const fixture = JSON.parse(await readFile(new URL("./fixtures/catalog-v1-web-4104385.contract.json", import.meta.url), "utf8"));
const rawServices = fixture.services as Record<string, unknown>[];
const releaseId = "catalog-v1-web-4104385";
const policies: PoliticaHome[] = [
  ["MIRAFLORES", "Miraflores", "MIRAFLORES", "INCLUDED", 0],
  ["SAN_BORJA", "San Borja", "SAN BORJA", "FIXED", 30],
  ["SURCO", "Surco", "SURCO", "FIXED", 30],
  ["SAN_ISIDRO", "San Isidro", "SAN ISIDRO", "FIXED", 30],
  ["BARRANCO", "Barranco", "BARRANCO", "FIXED", 30],
].map(([code, name, normalized, mode, fee]) => ({
  scope: "DISTRICT", districtCode: String(code), districtName: String(name), districtNormalized: String(normalized),
  pricingMode: mode as "INCLUDED" | "FIXED", feePen: Number(fee), requiresConfirmation: false,
  policyId: "HOME_MOBILITY_V1", policySha256: "a".repeat(64), releaseId,
}));
policies.push({ scope: "DEFAULT", districtCode: null, districtName: null, districtNormalized: null, pricingMode: "MANUAL_CONFIRMATION", feePen: null, requiresConfirmation: true, policyId: "HOME_MOBILITY_V1", policySha256: "a".repeat(64), releaseId });

const parsed = parsearSnapshotServicios(rawServices);
assert.equal(parsed.ok, true);
if (!parsed.ok) throw new Error(parsed.error);
const home = parsed.services.filter(servicioEsHome);

test("carga exactamente los 50 servicios del snapshot activo y usa price_pen", () => {
  assert.equal(parsed.services.length, 50);
  assert.equal(parsed.releaseId, releaseId);
  assert.equal(parsed.services.find((item) => item.serviceCode === "SVC_008")?.pricePen, rawServices.find((item) => item.service_code === "SVC_008")?.price_pen);
});

test("snapshot vacío, release mixto o inexistente falla cerrado", () => {
  assert.equal(parsearSnapshotServicios([]).ok, false);
  assert.equal(parsearSnapshotServicios(rawServices.map((row, index) => index === 0 ? { ...row, release_id: "inactive" } : row)).ok, false);
});

test("SVC_008 y SVC_009 son HOME por atributos, sin depender de DOM legacy", () => {
  assert.deepEqual(home.map((item) => item.serviceCode).sort(), ["SVC_008", "SVC_009"]);
  assert.equal(servicioEsHome({ category: "HOME", modality: "HOME" }), true);
});

test("ONE_PERSON, FIXED_TWO_PACKAGE y PROGRAM_PURCHASE respetan el contrato", () => {
  const one = parsed.services.find((item) => item.selectionRule === "ONE_PERSON")!;
  const pack = parsed.services.find((item) => item.selectionRule === "FIXED_TWO_PACKAGE")!;
  const program = parsed.services.find((item) => item.selectionRule === "PROGRAM_PURCHASE")!;
  assert.equal(validarSeleccionCita(1, [one]).ok, true);
  assert.equal(validarSeleccionCita(2, [one, one]).ok, true);
  assert.equal(validarSeleccionCita(2, [pack]).ok, true);
  assert.equal(validarSeleccionCita(1, [pack]).ok, false);
  assert.equal(validarSeleccionCita(1, [program]).ok, false);
});

test("normaliza distritos y aplica la movilidad canónica una sola vez", () => {
  assert.equal(normalizarDistrito("  San   Isídro "), "SAN ISIDRO");
  for (const [district, expected] of [["Miraflores", 0], ["San Borja", 30], ["Surco", 30], ["San Isidro", 30], ["Barranco", 30]] as const) {
    const result = calcularEconomiaHome(home, district, policies);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.feePen, expected);
      assert.equal(result.total, result.subtotal + expected);
    }
  }
});

test("distrito no configurado exige confirmación manual sin inventar tarifa", () => {
  const result = calcularEconomiaHome(home, "La Molina", policies);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual({ fee: result.feePen, total: result.total, confirmation: result.requiresConfirmation }, { fee: null, total: null, confirmation: true });
});

test("mínimo S/64.50 admite S/65 real y rechaza un monto inferior", () => {
  const required = calcularAdelantoRequerido({ canal: "directo", personas: 2, montoTotal: 129, esDomicilio: true });
  assert.equal(required, 64.5);
  const base = { adelantoRequerido: required, total: 129, metodoPago: "YAPE", numeroOperacion: "OP-1", metodosPermitidos: ["YAPE"] };
  assert.equal(validarPagoPreparacion({ ...base, montoPagado: 65 }), "");
  assert.match(validarPagoPreparacion({ ...base, montoPagado: 64.49 }), /al menos S\/64\.50/);
  assert.equal(129 - 65, 64);
});

test("Preparar cita no consulta staging ni reconoce HOME por DOM", async () => {
  const sources = await Promise.all([
    readFile(new URL("../app/preparar-cita/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/preparar-cita/actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/preparar-cita/PrepararCitaForm.tsx", import.meta.url), "utf8"),
  ]);
  const joined = sources.join("\n");
  assert.doesNotMatch(joined, /stg_services_catalog_v5|DOM-1H|DOM-2H|COSTO_MOVILIDAD_DOMICILIO/);
  assert.match(joined, /leerCatalogoPrepararCita/);
  assert.match(joined, /price_version/);
});

test("la política HOME exige seis reglas del mismo release", () => {
  const rows = policies.map((policy) => ({ scope: policy.scope, district_code: policy.districtCode, district_name: policy.districtName, district_normalized: policy.districtNormalized, pricing_mode: policy.pricingMode, fee_pen: policy.feePen, requires_confirmation: policy.requiresConfirmation, policy_id: policy.policyId, policy_sha256: policy.policySha256, release_id: policy.releaseId }));
  assert.equal(parsearPoliticasHome(rows, releaseId).ok, true);
  assert.equal(parsearPoliticasHome(rows.slice(1), releaseId).ok, false);
});

test("020 crea fronteras privadas y un resolver transaccional sin staging", async () => {
  const [sql, harness] = await Promise.all([
    readFile(new URL("../sql/020_preparar_cita_catalogo_canonico.sql", import.meta.url), "utf8"),
    readFile(new URL("../sql/tests/020_preparar_cita_catalogo_canonico_rollback.sql", import.meta.url), "utf8"),
  ]);
  for (const token of ["caja_catalog_active_services_read_v1", "caja_catalog_home_policy_read_v1", "caja_catalog_resolve_appointment_v1", "security definer", "service_role", "price_version", "valid_from", "valid_to", "MANUAL_CONFIRMATION"]) {
    assert.match(sql, new RegExp(token, "i"));
  }
  assert.doesNotMatch(sql, /\b(?:from|join)\s+public\.stg_services_catalog_v5/i);
  assert.doesNotMatch(sql, /pg_get_functiondef|execute\s+v_updated|v_definition|v_updated/i);
  assert.equal((sql.match(/create or replace function public\.preparar_ficha_cita\(p_payload jsonb\)/gi) ?? []).length, 1);
  assert.equal((sql.match(/create or replace function public\.preparar_atencion_personalizada\(p_payload jsonb\)/gi) ?? []).length, 1);
  assert.match(sql, /v_resuelto := public\.caja_catalog_resolve_appointment_v1/i);
  assert.match(sql, /from public\.caja_catalog_active_services_legacy_shape_v1 sc/i);
  assert.match(sql, /caja_preparar_cita_catalog_metadata_v1/i);
  assert.match(sql, /revoke all on function public\.caja_catalog_active_services_read_v1\(\) from public, anon, authenticated/i);
  assert.match(harness, /^begin;/i);
  assert.match(harness, /rollback;/i);
  assert.match(harness, /Miraflores|San Borja|Surco|San Isidro|Barranco/i);
  for (const token of ["QA_020_PACKAGE_TWO_INVALID", "QA_020_ONE_PERSON_X2_INVALID", "QA_020_HOME_TWO_PEOPLE_INVALID", "QA_020_HOME_BRANCH_MIX_SHOULD_FAIL", "QA_020_DEFAULT_RPC_SHOULD_FAIL", "QA_020_INACTIVE_SNAPSHOT_SHOULD_FAIL", "QA_020_INVALID_SNAPSHOT_SHOULD_FAIL"]) {
    assert.match(harness, new RegExp(token));
  }
});

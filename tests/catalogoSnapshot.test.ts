import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import { CATALOG_CATEGORY_COUNTS, type CanonicalService } from "../lib/catalogoCanonico.ts";
import { CatalogSnapshotError, HOME_POLICY_SHA256, validateHomePolicy } from "../lib/catalogoSnapshot.ts";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { syncCanonicalCatalogSnapshot } = await import("../lib/catalogoSnapshotServer.ts");
const { diagnoseCatalogSnapshot, syncCatalogSnapshotForAdmin } = await import("../lib/catalogoSnapshotDiagnosticoServer.ts");
hooks.deregister();

const catalogKey = "TEST_ONLY_CATALOG_KEY";
const cajaKey = "TEST_ONLY_CAJA_KEY";
const env = {
  CATALOG_CANONICAL_ENABLED: "true", CATALOG_SNAPSHOT_SYNC_ENABLED: "true",
  CATALOG_SUPABASE_URL: "https://wrbcdmcdxmhdwvftciro.supabase.co", CATALOG_SUPABASE_SERVICE_ROLE_KEY: catalogKey,
  CATALOG_EXPECTED_RELEASE_ID: "catalog-v1-web-4104385", CATALOG_EXPECTED_SERVICE_COUNT: "50",
  SUPABASE_URL: "https://operativa-caja.supabase.co", SUPABASE_SERVICE_ROLE_KEY: cajaKey,
};
function services(): CanonicalService[] {
  let n = 0;
  return Object.entries(CATALOG_CATEGORY_COUNTS).flatMap(([category, count]) => Array.from({ length: count }, () => {
    n += 1;
    return { service_code: `SVC_${String(n).padStart(3, "0")}` as `SVC_${string}`, slug: `s-${n}`, name_es: `Servicio ${n}`, name_en: null, included_es: null, included_en: null, category: category as CanonicalService["category"], commercial_group: null, modality: "QA", duration_min: 60, people_rule_status: "CONFIRMED", people_min: category === "PACKAGE_TWO" ? 2 : 1, people_max: category === "PACKAGE_TWO" || n === 8 || n === 9 ? 2 : 1, selection_rule: n === 8 || n === 9 ? "HOME_FLOW" : "QA", reservation_behavior: n === 8 || n === 9 ? "HOME_APPOINTMENT" : "QA", component_eligible: null, component_eligibility_status: "PENDING_REVIEW", active: true, price_pen: n === 8 ? 230 : n === 9 ? 120 : 100, previous_price_pen: null, price_version: "catalog-v1-web-4104385", valid_from: "2026-09-01T00:00:00+00:00", valid_to: null, release_id: "catalog-v1-web-4104385", source_web_sha: "4104385" };
  }));
}
const rules = [
  ["MIRAFLORES", "Miraflores", "INCLUDED", 0, false], ["SAN_BORJA", "San Borja", "FIXED", 30, false], ["SURCO", "Surco", "FIXED", 30, false], ["SAN_ISIDRO", "San Isidro", "FIXED", 30, false], ["BARRANCO", "Barranco", "FIXED", 30, false],
].map(([district_code, district_name, pricing_mode, fee_pen, requires_confirmation]) => ({ scope: "DISTRICT", district_code, district_name, district_normalized: String(district_code).replace("_", " "), pricing_mode, fee_pen, requires_confirmation })).concat([{ scope: "DEFAULT", district_code: null, district_name: null, district_normalized: null, pricing_mode: "MANUAL_CONFIRMATION", fee_pen: null, requires_confirmation: true }]);
const manifest = { release_id: "catalog-v1-web-4104385", policy_id: "HOME_MOBILITY_V1", charge_scope: "PER_APPOINTMENT", policy_sha256: HOME_POLICY_SHA256, active: true };
const metadata = { release_id: "catalog-v1-web-4104385", source_web_sha: "410438549a92d4766dcdeb4d17af07beba78f844", source_path: "content/services.ts", snapshot_sha256: "6ab5e47ac58c00a1a2f6739eab80fb8fda69e174733831f135ed5b8f04f9f654", expected_service_count: 50, status: "PUBLISHED", policy_id: "HOME_MOBILITY_V1", policy_sha256: HOME_POLICY_SHA256, charge_scope: "PER_APPOINTMENT" };

test("valida la política HOME contractual y rechaza cambios económicos", () => {
  assert.equal(validateHomePolicy(manifest, rules).length, 6);
  assert.throws(() => validateHomePolicy(manifest, rules.map((rule, i) => i === 1 ? { ...rule, fee_pen: 15 } : rule)));
});

test("sync server-side consume metadata por RPC y llama solo RPC local", async () => {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const result = await syncCanonicalCatalogSnapshot({ env, fetcher: async (input, init) => {
    const url = new URL(String(input)); calls.push({ url, init });
    const headers = new Headers(init?.headers);
    if (url.origin === env.CATALOG_SUPABASE_URL) {
      assert.equal(headers.get("apikey"), catalogKey);
      if (url.pathname.endsWith("catalog_services_read_v1")) return Response.json(services(), { headers: { "content-range": "0-49/50" } });
      if (url.pathname.endsWith("catalog_get_snapshot_metadata_v1")) {
        assert.equal(init?.method, "POST");
        assert.deepEqual(JSON.parse(String(init?.body)), { p_release_id: "catalog-v1-web-4104385" });
        assert.equal(headers.get("Content-Profile"), "public");
        return Response.json(metadata);
      }
      if (url.pathname.endsWith("catalog_home_policy_read_v1")) return Response.json(rules);
      assert.fail(`unexpected catalog endpoint: ${url.pathname}`);
    }
    assert.equal(url.origin, env.SUPABASE_URL);
    assert.equal(url.pathname, "/rest/v1/rpc/caja_import_catalog_snapshot_v1");
    assert.equal(headers.get("apikey"), cajaKey);
    assert.equal(JSON.parse(String(init?.body)).p_services.length, 50);
    return Response.json({ release_id: "catalog-v1-web-4104385", services: 50, home_rules: 6, active: true });
  } });
  assert.deepEqual(result, { source: "canonical", release: "catalog-v1-web-4104385", services: 50, home_rules: 6, checksum: HOME_POLICY_SHA256, status: "SYNCED" });
  assert.equal(calls.length, 4);
  assert.ok(calls.some(({ url }) => url.pathname.endsWith("catalog_get_snapshot_metadata_v1")));
  assert.ok(calls.every(({ url }) => !url.pathname.endsWith("catalog_releases") && !url.pathname.endsWith("catalog_home_policy_manifests_v1")));
});

test("metadata RPC inválida, incompleta o rechazada falla REMOTE antes de importar", async () => {
  const invalidMetadata = [
    { ...metadata, release_id: "catalog-v2-web-4104385" }, { ...metadata, status: "DRAFT" },
    { ...metadata, source_web_sha: "invalid" }, { ...metadata, snapshot_sha256: "invalid" },
    { ...metadata, expected_service_count: 49 }, { ...metadata, policy_id: "HOME_MOBILITY_V2" },
    { ...metadata, policy_sha256: "0".repeat(64) }, { ...metadata, charge_scope: "PER_SERVICE" }, {}, [],
  ];
  for (const remoteMetadata of invalidMetadata) {
    await assert.rejects(syncCanonicalCatalogSnapshot({ env, fetcher: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("catalog_services_read_v1")) return Response.json(services(), { headers: { "content-range": "0-49/50" } });
      if (url.pathname.endsWith("catalog_get_snapshot_metadata_v1")) return Response.json(remoteMetadata);
      assert.fail(`metadata inválida no debe consultar: ${url.pathname}`);
    } }), (error: unknown) => error instanceof CatalogSnapshotError && error.code === "REMOTE");
  }
  for (const status of [403, 500]) {
    await assert.rejects(syncCanonicalCatalogSnapshot({ env, fetcher: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("catalog_services_read_v1")) return Response.json(services(), { headers: { "content-range": "0-49/50" } });
      return new Response("provider detail", { status });
    } }), (error: unknown) => error instanceof CatalogSnapshotError && error.code === "REMOTE");
  }
});

test("sync fail-closed no usa fallback legacy ni mezcla claves", async () => {
  await assert.rejects(syncCanonicalCatalogSnapshot({ env: { ...env, SUPABASE_SERVICE_ROLE_KEY: catalogKey }, fetcher: async () => { assert.fail("no fetch"); } }));
  await assert.rejects(syncCanonicalCatalogSnapshot({ env: { ...env, CATALOG_SNAPSHOT_SYNC_ENABLED: "false" }, fetcher: async () => { assert.fail("no fetch"); } }));
  await assert.rejects(syncCanonicalCatalogSnapshot({ env, fetcher: async () => new Response("secret", { status: 500 }) }));
});

test("acción y diagnóstico son solo ADMIN_GERALD y nunca devuelven credenciales", async () => {
  for (const session of [null, { rol: "SOCIO" }]) assert.equal((await syncCatalogSnapshotForAdmin(session, async () => { assert.fail("no sync"); })).status, session ? 403 : 401);
  const admin = await syncCatalogSnapshotForAdmin({ rol: "ADMIN_GERALD" }, async () => ({ source: "canonical", release: "catalog-v1-web-4104385", services: 50, home_rules: 6, checksum: HOME_POLICY_SHA256, status: "SYNCED" as const }));
  assert.equal(admin.status, 200); assert.doesNotMatch(JSON.stringify(admin), /KEY|SUPABASE|https/i);
  const diagnostic = await diagnoseCatalogSnapshot({ rol: "ADMIN_GERALD" }, async () => ({ release_id: "catalog-v1-web-4104385", services: 50, home_rules: 6, home_policy_sha256: HOME_POLICY_SHA256 }));
  assert.equal("in_sync" in diagnostic.body && diagnostic.body.in_sync, true);
});

test("migración y harness 018 son privados, inmutables y transaccionales", async () => {
  const [sql, harness, route] = await Promise.all([readFile(new URL("../sql/018_catalogo_canonico_snapshot_local.sql", import.meta.url), "utf8"), readFile(new URL("../sql/tests/018_catalogo_canonico_snapshot_local_rollback.sql", import.meta.url), "utf8"), readFile(new URL("../app/api/admin/catalogo/snapshot/route.ts", import.meta.url), "utf8")]);
  for (const token of ["caja_catalog_releases", "caja_catalog_services", "caja_catalog_home_policy", "caja_import_catalog_snapshot_v1", "security definer", "CAJA_CATALOG_SNAPSHOT_IMMUTABLE", "CAJA_CATALOG_CONTENT_CONFLICT", "PENDING_REVIEW", "SVC_008", "SVC_009", "MIRAFLORES", "SAN_BORJA", "SAN_ISIDRO", "MANUAL_CONFIRMATION", "source_web_sha ~ '^[0-9a-f]{40}$'", "revoke all on table", "grant execute"]) assert.match(sql, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.match(harness, /price_version/i); assert.match(harness, /valid_from/i); assert.match(harness, /valid_to/i);
  assert.doesNotMatch(harness, /effective_from|effective_to/i);
  for (const token of ["begin;", "rollback;", "idempotente", "district_code", "district_name", "district_normalized", "requires_confirmation", "CAJA_CATALOG_SERVICE_COUNT_INVALID", "CAJA_CATALOG_HOME_RULES_INVALID", "CAJA_CATALOG_CONTENT_CONFLICT"]) assert.match(harness, new RegExp(token, "i"));
  assert.match(route, /syncCatalogSnapshotForAdmin/); assert.match(route, /diagnoseCatalogSnapshot/);
});

test("019 alinea la RPC local con vigencia y versión de precio canónicas", async () => {
  const [migration, runner, workflow] = await Promise.all([
    readFile(new URL("../sql/019_catalog_snapshot_contract_alignment.sql", import.meta.url), "utf8"),
    readFile(new URL("./run-catalog-snapshot-postgres-validation.mjs", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/catalog-contract-sql.yml", import.meta.url), "utf8"),
  ]);
  for (const token of ["rename column effective_from to valid_from", "rename column effective_to to valid_to", "add column price_version text not null", "price_version text", "valid_from timestamptz", "valid_to timestamptz", "CAJA_CATALOG_CONTRACT_ALIGNMENT_REQUIRES_EMPTY_SNAPSHOT"]) assert.match(migration, new RegExp(token, "i"));
  const importFunction = migration.slice(
    migration.indexOf("create or replace function public.caja_import_catalog_snapshot_v1"),
  );
  assert.doesNotMatch(importFunction, /effective_from|effective_to/i);
  assert.match(
    importFunction,
    /insert into public\.caja_catalog_services\([^)]*previous_price_pen,valid_from,valid_to,price_version\)/i,
  );
  assert.match(runner, /018_catalogo_canonico_snapshot_local\.sql/i);
  assert.match(runner, /019_catalog_snapshot_contract_alignment\.sql/i);
  assert.match(runner, /018_catalogo_canonico_snapshot_local_rollback\.sql/i);
  assert.match(runner, /CATALOG_SNAPSHOT_POSTGRES_CONTRACT=PASS/);
  assert.match(runner, /DATABASE_URL/i);
  assert.match(runner, /spawnSync/i);
  assert.match(runner, /docker/i);
  for (const token of ["pull_request:", "workflow_dispatch:", "postgres:16-alpine", "DATABASE_URL", "npm run test:sql"]) assert.match(workflow, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
});

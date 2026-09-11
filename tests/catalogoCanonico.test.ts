import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import {
  CATALOG_CATEGORY_COUNTS, CATALOG_COLUMNS, CATALOG_RELEASE_ID, CatalogError,
  validateCanonicalCatalog, type CanonicalService,
} from "../lib/catalogoCanonico.ts";

// Solo en este proceso de pruebas: Next sustituye server-only en el servidor.
// Las llamadas se inyectan; nunca se carga .env.local ni se consulta Supabase.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const { readCanonicalCatalog } = await import("../lib/catalogoCanonicoServer.ts");
const { diagnoseCatalog } = await import("../lib/catalogoDiagnosticoServer.ts");
hooks.deregister();

const fakeKey = "TEST_ONLY_CATALOG_KEY_NOT_A_CREDENTIAL";
const env = {
  CATALOG_CANONICAL_ENABLED: "true",
  CATALOG_SUPABASE_URL: "https://wrbcdmcdxmhdwvftciro.supabase.co",
  CATALOG_SUPABASE_SERVICE_ROLE_KEY: fakeKey,
  CATALOG_EXPECTED_RELEASE_ID: CATALOG_RELEASE_ID,
  CATALOG_EXPECTED_SERVICE_COUNT: "50",
};

function fixture(): CanonicalService[] {
  let number = 0;
  return Object.entries(CATALOG_CATEGORY_COUNTS).flatMap(([category, count]) =>
    Array.from({ length: count }, () => {
      number += 1;
      return {
        service_code: `SVC_${String(number).padStart(3, "0")}` as CanonicalService["service_code"],
        slug: `servicio-sintetico-${number}`, name_es: `Servicio de prueba ${number}`,
        name_en: null, category: category as CanonicalService["category"],
        commercial_group: null, modality: "TEST_MODALITY", duration_min: 60,
        people_rule_status: "TEST_RULE", people_min: category === "PACKAGE_TWO" ? 2 : 1,
        people_max: category === "PACKAGE_TWO" || number === 8 || number === 9 ? 2 : 1,
        selection_rule: "TEST_SELECTION", reservation_behavior: "TEST_RESERVATION",
        component_eligible: null, component_eligibility_status: "PENDING_REVIEW",
        active: true, price_pen: 100, previous_price_pen: null, price_version: 1,
        valid_from: "2026-09-01T00:00:00+00:00", valid_to: null,
        release_id: CATALOG_RELEASE_ID, source_web_sha: "4104385",
      };
    }),
  );
}

function response(payload: unknown = fixture(), range = "0-49/50") {
  return Response.json(payload, { headers: { "content-range": range } });
}

function expectCode(code: string) {
  return (error: unknown) => error instanceof CatalogError && error.code === code;
}

test("acepta y conserva el contrato de 50 servicios y proyecta solo las columnas permitidas", () => {
  const rows = fixture();
  rows[0].name_en = "Test service";
  rows[0].commercial_group = "TEST_GROUP";
  rows[0].previous_price_pen = 120;
  rows[0].price_version = "v1";
  rows[0].valid_to = "2027-01-01";
  rows[0].component_eligible = false;
  const result = validateCanonicalCatalog(rows.map((row) => ({ ...row, secret: fakeKey })));
  assert.deepEqual(result, rows);
  assert.deepEqual(Object.keys(result[0]), CATALOG_COLUMNS);
  assert.equal(result.every((row) => row.component_eligibility_status === "PENDING_REVIEW"), true);
  assert.equal(JSON.stringify(result).includes(fakeKey), false);
});

for (const [name, change, code] of [
  ["incompleto", (rows) => rows.pop(), "COUNT"],
  ["excedente", (rows) => rows.push({ ...rows[0] }), "COUNT"],
  ["release mixto", (rows) => { rows[49].release_id = "otro-release"; }, "RELEASE"],
  ["inactivo", (rows) => { rows[0].active = false; }, "ACTIVE"],
  ["booleano como texto", (rows) => { rows[0].active = "true"; }, "ACTIVE"],
  ["código duplicado", (rows) => { rows[49].service_code = rows[0].service_code; }, "CODE"],
  ["formato de código", (rows) => { rows[0].service_code = "SVC_01"; }, "CODE"],
  ["falta código especial", (rows) => { rows[7].service_code = "SVC_099"; }, "CODE"],
  ["categoría desconocida", (rows) => { rows[0].category = "OTHER"; }, "CATEGORY"],
  ["distribución incorrecta", (rows) => { rows[0].category = "BEAUTY"; }, "CATEGORY"],
  ["paquete para una persona", (rows) => { rows[23].people_min = 1; }, "PEOPLE"],
  ["paquete para tres personas", (rows) => { rows[23].people_max = 3; }, "PEOPLE"],
  ["SVC_008 solo una persona", (rows) => { rows[7].people_max = 1; }, "PEOPLE"],
  ["SVC_009 solo dos personas", (rows) => { rows[8].people_min = 2; }, "PEOPLE"],
  ["personas invertidas", (rows) => { rows[0].people_min = 2; }, "PEOPLE"],
  ["personas fraccionarias", (rows) => { rows[0].people_max = 1.5; }, "PEOPLE"],
  ["precio cero", (rows) => { rows[0].price_pen = 0; }, "ECONOMICS"],
  ["precio negativo", (rows) => { rows[0].price_pen = -1; }, "ECONOMICS"],
  ["precio no finito", (rows) => { rows[0].price_pen = Infinity; }, "ECONOMICS"],
  ["precio como texto", (rows) => { rows[0].price_pen = "100"; }, "ECONOMICS"],
  ["precio anterior inválido", (rows) => { rows[0].previous_price_pen = -1; }, "ECONOMICS"],
  ["duración cero", (rows) => { rows[0].duration_min = 0; }, "ECONOMICS"],
  ["duración NaN", (rows) => { rows[0].duration_min = NaN; }, "ECONOMICS"],
  ["componente ya revisado", (rows) => { rows[49].component_eligibility_status = "APPROVED"; }, "COMPONENTS"],
  ["elegibilidad como texto", (rows) => { rows[0].component_eligible = "false"; }, "COMPONENTS"],
  ["nombre ausente", (rows) => { delete rows[0].name_es; }, "SERVICE"],
  ["versión ausente", (rows) => { delete rows[0].price_version; }, "SERVICE"],
  ["vigencia ilegible", (rows) => { rows[0].valid_from = "ayer"; }, "VALIDITY"],
  ["fecha imposible", (rows) => { rows[0].valid_from = "2026-02-30"; }, "VALIDITY"],
  ["vigencia invertida", (rows) => { rows[0].valid_to = "2026-01-01"; }, "VALIDITY"],
] as [string, (rows: Record<string, unknown>[]) => void, string][]) {
  test(`rechaza ${name}`, () => {
    const rows: Record<string, unknown>[] = fixture();
    change(rows);
    assert.throws(() => validateCanonicalCatalog(rows), expectCode(code));
  });
}

test("rechaza estructuras JSON inválidas y campos ausentes", () => {
  for (const payload of [null, {}, "50", { data: fixture() }]) {
    assert.throws(() => validateCanonicalCatalog(payload), expectCode("RESPONSE"));
  }
  for (const column of CATALOG_COLUMNS) {
    const rows: Record<string, unknown>[] = fixture();
    delete rows[0][column];
    assert.throws(() => validateCanonicalCatalog(rows), CatalogError, column);
  }
});

test("bandera deshabilitada conserva legacy sin leer conexión ni ejecutar fetch", async () => {
  for (const flag of [undefined, "", "false", "TRUE", " true ", "1", "yes"]) {
    const result = await readCanonicalCatalog({
      env: { CATALOG_CANONICAL_ENABLED: flag, get CATALOG_SUPABASE_SERVICE_ROLE_KEY(): string { throw new Error("No leer credenciales"); } },
      fetcher: async () => { assert.fail("No debe consultar el catálogo"); },
    });
    assert.deepEqual(result, { source: "legacy", services: null });
  }
});

test("consulta solo la vista server-side secundaria sin filtros que oculten filas inválidas", async () => {
  let calls = 0;
  const result = await readCanonicalCatalog({ env, fetcher: async (input, init) => {
    calls += 1;
    const url = new URL(String(input));
    assert.equal(url.origin, env.CATALOG_SUPABASE_URL);
    assert.equal(url.pathname, "/rest/v1/catalog_services_read_v1");
    assert.equal(url.searchParams.get("select"), CATALOG_COLUMNS.join(","));
    assert.deepEqual([...url.searchParams.keys()], ["select", "order", "limit"]);
    assert.equal(url.searchParams.get("limit"), "51");
    assert.equal(init?.method, "GET");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal instanceof AbortSignal);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("apikey"), fakeKey);
    assert.equal(headers.get("Authorization"), `Bearer ${fakeKey}`);
    assert.equal(headers.get("Prefer"), "count=exact");
    assert.equal(headers.get("Accept-Profile"), "public");
    return response();
  } });
  assert.deepEqual(result, { source: "canonical", services: fixture() });
  assert.equal(calls, 1);
});

test("configuración incompleta o diferente no consulta ni usa credenciales de Caja", async () => {
  const invalidEnvs = [
    ...Object.keys(env).filter((key) => key !== "CATALOG_CANONICAL_ENABLED").map((key) => ({ ...env, [key]: undefined })),
    { ...env, CATALOG_EXPECTED_RELEASE_ID: "otro" },
    { ...env, CATALOG_EXPECTED_SERVICE_COUNT: "49" },
    ...["http://wrbcdmcdxmhdwvftciro.supabase.co", "https://other.supabase.co", `${env.CATALOG_SUPABASE_URL}/rest/v1`, `${env.CATALOG_SUPABASE_URL}?key=hidden`, "https://user:password@wrbcdmcdxmhdwvftciro.supabase.co", "invalid-url"].map((url) => ({ ...env, CATALOG_SUPABASE_URL: url })),
  ];
  for (const invalidEnv of invalidEnvs) {
    await assert.rejects(readCanonicalCatalog({ env: invalidEnv, fetcher: async () => { assert.fail("No debe consultar"); } }), expectCode("CONFIGURATION"));
  }
});

test("rechaza filas truncadas aunque el cuerpo contenga 50 servicios", async () => {
  for (const range of ["0-49/51", "0-48/50", "0-49/*", "1-50/50", "", "*/50"]) {
    await assert.rejects(readCanonicalCatalog({ env, fetcher: async () => response(fixture(), range) }), expectCode("COUNT"));
  }
});

test("fallos habilitados nunca retornan legacy ni filtran mensajes HTTP o excepciones", async () => {
  for (const [fetcher, code] of [
    [async () => new Response(fakeKey, { status: 401 }), "CONNECTION"],
    [async () => new Response(fakeKey, { status: 500 }), "CONNECTION"],
    [async () => { throw new Error(fakeKey); }, "CONNECTION"],
    [async () => { throw new DOMException(fakeKey, "TimeoutError"); }, "CONNECTION"],
    [async () => new Response(fakeKey, { headers: { "content-range": "0-49/50" } }), "RESPONSE"],
    [async () => response(fixture().slice(0, 49)), "COUNT"],
    [async () => response(fixture().map((row) => ({ ...row, release_id: "incorrecto" }))), "RELEASE"],
  ] as [typeof fetch, string][]) {
    await assert.rejects(readCanonicalCatalog({ env, fetcher }), (error: unknown) => {
      assert.ok(error instanceof CatalogError);
      assert.equal(error.code, code);
      assert.equal(error.message.includes(fakeKey), false);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test("diagnóstico deniega anónimos y roles no administradores antes de consultar", async () => {
  for (const session of [null, { rol: "SOCIO" }, { rol: "VITA_OPERACION" }, { rol: "ADMIN" }]) {
    const result = await diagnoseCatalog(session, async () => { assert.fail("Consulta no autorizada"); });
    assert.equal(result.status, session ? 403 : 401);
  }
});

test("diagnóstico admin informa release, total, distribución y todos los intervalos", async () => {
  const rows = fixture();
  rows[0].valid_to = "2027-01-01";
  const result = await diagnoseCatalog({ rol: "ADMIN_GERALD" }, () => readCanonicalCatalog({ env, fetcher: async () => response(rows) }));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, source: "canonical", connection: "OK", release: CATALOG_RELEASE_ID, total: 50, categories: CATALOG_CATEGORY_COUNTS,
    validity: [{ valid_from: rows[0].valid_from, valid_to: "2027-01-01" }, { valid_from: rows[0].valid_from, valid_to: null }] });
  assert.doesNotMatch(JSON.stringify(result), /apikey|Authorization|CATALOG_SUPABASE|TEST_ONLY_CATALOG_KEY/);
});

test("diagnóstico distingue deshabilitado de fallo visible 503 sin secretos", async () => {
  const admin = { rol: "ADMIN_GERALD" };
  const disabled = await diagnoseCatalog(admin, () => readCanonicalCatalog({ env: {} }));
  assert.equal(disabled.body.connection, "NOT_CHECKED");
  assert.equal(disabled.body.source, "legacy");
  for (const read of [
    () => readCanonicalCatalog({ env, fetcher: async () => response([]) }),
    async () => { throw new Error(fakeKey); },
  ]) {
    const failed = await diagnoseCatalog(admin, read);
    assert.equal(failed.status, 503);
    assert.equal(failed.body.ok, false);
    assert.equal(failed.body.source, "canonical");
    assert.equal(JSON.stringify(failed).includes(fakeKey), false);
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { CATALOG_COLUMNS, CATALOG_RELEASE_ID, validateCanonicalCatalog } from "../lib/catalogoCanonico.ts";
import {
  CATALOG_SNAPSHOT_SERVICE_COLUMNS, buildCatalogSnapshotPayload, metadataFromRpc,
  toCatalogSnapshotService, validateHomePolicy,
} from "../lib/catalogoSnapshot.ts";

type ContractFixture = { metadata: Record<string, unknown>; services: unknown; home_rules: unknown };

async function fixture(): Promise<ContractFixture> {
  return JSON.parse(await readFile(new URL("./fixtures/catalog-v1-web-4104385.contract.json", import.meta.url), "utf8")) as ContractFixture;
}

test("contrato vertical canónico conserva los 50 servicios, vigencia, versión y HOME hasta el payload SQL", async () => {
  const input = await fixture();
  const services = validateCanonicalCatalog(input.services);
  const { metadata, manifest } = metadataFromRpc(input.metadata);
  const rules = validateHomePolicy(manifest, input.home_rules);
  const payload = buildCatalogSnapshotPayload(metadata, services, rules);

  assert.equal(payload.services.length, 50);
  assert.equal(new Set(payload.services.map((service) => service.service_code)).size, 50);
  assert.deepEqual(Object.fromEntries(["INDIVIDUAL", "PACKAGE_TWO", "HOME", "PROGRAM", "BEAUTY", "FACIAL"].map((category) => [category, payload.services.filter((service) => service.category === category).length])), { INDIVIDUAL: 23, PACKAGE_TWO: 14, HOME: 2, PROGRAM: 4, BEAUTY: 3, FACIAL: 4 });
  for (const service of payload.services) {
    assert.deepEqual(Object.keys(toCatalogSnapshotService(service)), CATALOG_SNAPSHOT_SERVICE_COLUMNS);
    for (const field of ["service_code", "price_pen", "duration_min", "valid_from", "valid_to", "price_version", "release_id", "source_web_sha"] as const) assert.ok(field in service);
    assert.equal(service.release_id, CATALOG_RELEASE_ID);
    assert.equal(typeof service.price_version, "string");
  }
  assert.deepEqual(CATALOG_SNAPSHOT_SERVICE_COLUMNS, CATALOG_COLUMNS);
  assert.equal(payload.home_rules.length, 6);
  for (const rule of payload.home_rules) for (const field of ["district_code", "district_name", "district_normalized", "fee_pen", "requires_confirmation"] as const) assert.ok(field in rule);
  assert.equal(payload.home_manifest.policy_sha256, "c94adc0adb80f56af291221a4363a4ddcd319790af73b64e2c9a42f69dee9bf1");
});

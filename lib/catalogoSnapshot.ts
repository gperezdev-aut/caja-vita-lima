import { createHash } from "node:crypto";
import {
  CATALOG_COLUMNS, CATALOG_RELEASE_ID, CATALOG_SERVICE_COUNT, CatalogError,
  type CanonicalService,
} from "./catalogoCanonico.ts";

export const HOME_POLICY_ID = "HOME_MOBILITY_V1";
export const HOME_POLICY_SHA256 = "c94adc0adb80f56af291221a4363a4ddcd319790af73b64e2c9a42f69dee9bf1";
export const HOME_CHARGE_SCOPE = "PER_APPOINTMENT";

export type HomePolicyRule = {
  scope: "DISTRICT" | "DEFAULT";
  district_code: string | null;
  district_name: string | null;
  district_normalized: string | null;
  pricing_mode: "INCLUDED" | "FIXED" | "MANUAL_CONFIRMATION";
  fee_pen: number | null;
  requires_confirmation: boolean;
};

export type CatalogReleaseMetadata = {
  release_id: typeof CATALOG_RELEASE_ID;
  source_web_sha: string;
  source_path: string;
  source_snapshot_sha256: string;
  expected_service_count: number;
};

/** El payload local conserva el contrato del servicio canónico, sin aliases effective_*. */
export type CatalogSnapshotService = CanonicalService;
export const CATALOG_SNAPSHOT_SERVICE_COLUMNS = CATALOG_COLUMNS;

export function toCatalogSnapshotService(service: CanonicalService): CatalogSnapshotService {
  return Object.fromEntries(CATALOG_SNAPSHOT_SERVICE_COLUMNS.map((key) => [key, service[key]])) as CatalogSnapshotService;
}

export class CatalogSnapshotError extends Error {
  readonly code: "CONFIGURATION" | "REMOTE" | "HOME" | "LOCAL" | "DISABLED";

  constructor(code: "CONFIGURATION" | "REMOTE" | "HOME" | "LOCAL" | "DISABLED") {
    super("No se pudo sincronizar el snapshot canónico.");
    this.name = "CatalogSnapshotError";
    this.code = code;
  }
}

export function metadataFromRpc(payload: unknown): { metadata: CatalogReleaseMetadata; manifest: Record<string, unknown> } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new CatalogSnapshotError("REMOTE");
  const row = payload as Record<string, unknown>;
  if (row.release_id !== CATALOG_RELEASE_ID || row.status !== "PUBLISHED" ||
      typeof row.source_web_sha !== "string" || !/^[0-9a-f]{40}$/.test(row.source_web_sha) ||
      typeof row.source_path !== "string" || !row.source_path.trim() ||
      typeof row.snapshot_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(row.snapshot_sha256) ||
      row.expected_service_count !== 50 || row.policy_id !== HOME_POLICY_ID ||
      row.policy_sha256 !== HOME_POLICY_SHA256 || row.charge_scope !== HOME_CHARGE_SCOPE) throw new CatalogSnapshotError("REMOTE");
  return {
    metadata: { release_id: CATALOG_RELEASE_ID, source_web_sha: row.source_web_sha, source_path: row.source_path, source_snapshot_sha256: row.snapshot_sha256, expected_service_count: 50 },
    manifest: { release_id: CATALOG_RELEASE_ID, policy_id: row.policy_id, policy_sha256: row.policy_sha256, charge_scope: row.charge_scope, active: true },
  };
}

const ruleOrder = ["MIRAFLORES", "SAN BORJA", "SURCO", "SAN ISIDRO", "BARRANCO", "DEFAULT"];

function stringOrNull(value: unknown): string | null {
  return value === null ? null : typeof value === "string" && value.trim() ? value : null;
}

function ruleKey(rule: HomePolicyRule) {
  return rule.scope === "DEFAULT" ? "DEFAULT" : rule.district_normalized;
}

export function validateHomePolicy(manifest: unknown, payload: unknown): HomePolicyRule[] {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || !Array.isArray(payload)) {
    throw new CatalogSnapshotError("HOME");
  }
  const header = manifest as Record<string, unknown>;
  if (header.release_id !== CATALOG_RELEASE_ID || header.policy_id !== HOME_POLICY_ID ||
      header.charge_scope !== HOME_CHARGE_SCOPE || header.policy_sha256 !== HOME_POLICY_SHA256 || header.active !== true || payload.length !== 6) {
    throw new CatalogSnapshotError("HOME");
  }
  const keys = new Set<string>();
  const rules = payload.map((value): HomePolicyRule => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new CatalogSnapshotError("HOME");
    const row = value as Record<string, unknown>;
    const scope = row.scope;
    const rule: HomePolicyRule = {
      scope: scope === "DISTRICT" || scope === "DEFAULT" ? scope : (() => { throw new CatalogSnapshotError("HOME"); })(),
      district_code: stringOrNull(row.district_code), district_name: stringOrNull(row.district_name),
      district_normalized: stringOrNull(row.district_normalized),
      pricing_mode: row.pricing_mode === "INCLUDED" || row.pricing_mode === "FIXED" || row.pricing_mode === "MANUAL_CONFIRMATION"
        ? row.pricing_mode : (() => { throw new CatalogSnapshotError("HOME"); })(),
      fee_pen: row.fee_pen === null ? null : typeof row.fee_pen === "number" && Number.isFinite(row.fee_pen) ? row.fee_pen : (() => { throw new CatalogSnapshotError("HOME"); })(),
      requires_confirmation: typeof row.requires_confirmation === "boolean" ? row.requires_confirmation : (() => { throw new CatalogSnapshotError("HOME"); })(),
    };
    const key = ruleKey(rule);
    if (!key || keys.has(key)) throw new CatalogSnapshotError("HOME");
    keys.add(key);
    return rule;
  });
  const ordered = [...rules].sort((a, b) => ruleOrder.indexOf(ruleKey(a)!) - ruleOrder.indexOf(ruleKey(b)!));
  if (ordered.map((rule) => ruleKey(rule)).join("|") !== ruleOrder.join("|")) throw new CatalogSnapshotError("HOME");
  const canonical = [
    `${HOME_POLICY_ID}|${HOME_CHARGE_SCOPE}`,
    ...ordered.map((rule) => [rule.scope, rule.district_code ?? "", rule.district_name ?? "", rule.district_normalized ?? "", rule.pricing_mode, rule.fee_pen ?? "NULL", rule.requires_confirmation].join("|")),
  ].join("\n");
  if (createHash("sha256").update(canonical).digest("hex") !== HOME_POLICY_SHA256) throw new CatalogSnapshotError("HOME");
  const byKey = Object.fromEntries(ordered.map((rule) => [ruleKey(rule)!, rule]));
  const fixed30 = ["SAN BORJA", "SURCO", "SAN ISIDRO", "BARRANCO"];
  if (byKey.MIRAFLORES.pricing_mode !== "INCLUDED" || byKey.MIRAFLORES.fee_pen !== 0 || byKey.MIRAFLORES.requires_confirmation ||
      fixed30.some((key) => byKey[key].pricing_mode !== "FIXED" || byKey[key].fee_pen !== 30 || byKey[key].requires_confirmation) ||
      byKey.DEFAULT.pricing_mode !== "MANUAL_CONFIRMATION" || byKey.DEFAULT.fee_pen !== null || !byKey.DEFAULT.requires_confirmation) throw new CatalogSnapshotError("HOME");
  return ordered;
}

export function buildCatalogSnapshotPayload(metadata: CatalogReleaseMetadata, services: CanonicalService[], rules: HomePolicyRule[]) {
  if (metadata.release_id !== CATALOG_RELEASE_ID || metadata.expected_service_count !== CATALOG_SERVICE_COUNT || services.length !== CATALOG_SERVICE_COUNT) {
    throw new CatalogSnapshotError("REMOTE");
  }
  return {
    release: metadata,
    services: services.map(toCatalogSnapshotService),
    home_manifest: { release_id: metadata.release_id, policy_id: HOME_POLICY_ID, policy_sha256: HOME_POLICY_SHA256, charge_scope: HOME_CHARGE_SCOPE, active: true },
    home_rules: rules,
  };
}

export function asSnapshotError(error: unknown) {
  return error instanceof CatalogSnapshotError || error instanceof CatalogError ? error : new CatalogSnapshotError("REMOTE");
}

import "server-only";

import { CATALOG_RELEASE_ID, CatalogError } from "./catalogoCanonico.ts";
import { catalogConnection, readCanonicalCatalog } from "./catalogoCanonicoServer.ts";
import {
  asSnapshotError, buildCatalogSnapshotPayload, CatalogSnapshotError,
  validateHomePolicy, type CatalogReleaseMetadata,
} from "./catalogoSnapshot.ts";

type SnapshotEnv = Record<string, string | undefined> & {
  SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string;
  CATALOG_SNAPSHOT_SYNC_ENABLED?: string;
};
type Fetcher = typeof fetch;

function localConnection(env: SnapshotEnv, catalog: { origin: string; key: string }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY?.trim()) throw new CatalogSnapshotError("CONFIGURATION");
  let origin: string;
  try {
    const url = new URL(env.SUPABASE_URL);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
    origin = url.origin;
  } catch { throw new CatalogSnapshotError("CONFIGURATION"); }
  if (origin === catalog.origin || env.SUPABASE_SERVICE_ROLE_KEY === catalog.key) throw new CatalogSnapshotError("CONFIGURATION");
  return { origin, key: env.SUPABASE_SERVICE_ROLE_KEY };
}

async function getJson(fetcher: Fetcher, url: string, key: string): Promise<unknown> {
  try {
    const response = await fetcher(url, { method: "GET", headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "public" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error();
    return await response.json();
  } catch { throw new CatalogSnapshotError("REMOTE"); }
}

export function isCatalogSnapshotSyncEnabled(env: SnapshotEnv = process.env) {
  return env.CATALOG_SNAPSHOT_SYNC_ENABLED === "true";
}

export async function syncCanonicalCatalogSnapshot({ env = process.env, fetcher = fetch }: { env?: SnapshotEnv; fetcher?: Fetcher } = {}) {
  if (!isCatalogSnapshotSyncEnabled(env)) throw new CatalogSnapshotError("DISABLED");
  try {
    const catalog = catalogConnection(env);
    const local = localConnection(env, catalog);
    const read = await readCanonicalCatalog({ env, fetcher });
    if (read.source !== "canonical" || !read.services) throw new CatalogSnapshotError("REMOTE");
    const query = new URLSearchParams({ select: "release_id,source_web_sha,source_path,snapshot_sha256,expected_service_count,status", release_id: `eq.${CATALOG_RELEASE_ID}`, status: "eq.PUBLISHED", limit: "2" });
    const releases = await getJson(fetcher, `${catalog.origin}/rest/v1/catalog_releases?${query}`, catalog.key);
    const manifest = await getJson(fetcher, `${catalog.origin}/rest/v1/catalog_home_policy_manifests_v1?release_id=eq.${CATALOG_RELEASE_ID}&active=eq.true&select=release_id,policy_id,policy_sha256,charge_scope,active&limit=2`, catalog.key);
    const rules = await getJson(fetcher, `${catalog.origin}/rest/v1/catalog_home_policy_read_v1?release_id=eq.${CATALOG_RELEASE_ID}&select=scope,district_code,district_name,district_normalized,pricing_mode,fee_pen,requires_confirmation,active&limit=7`, catalog.key);
    if (!Array.isArray(releases) || releases.length !== 1 || !Array.isArray(manifest) || manifest.length !== 1) throw new CatalogSnapshotError("REMOTE");
    const release = releases[0] as Record<string, unknown>;
    const metadata: CatalogReleaseMetadata = {
      release_id: release.release_id === CATALOG_RELEASE_ID ? CATALOG_RELEASE_ID : (() => { throw new CatalogSnapshotError("REMOTE"); })(),
      source_web_sha: typeof release.source_web_sha === "string" ? release.source_web_sha : (() => { throw new CatalogSnapshotError("REMOTE"); })(),
      source_path: typeof release.source_path === "string" ? release.source_path : (() => { throw new CatalogSnapshotError("REMOTE"); })(),
      source_snapshot_sha256: typeof release.snapshot_sha256 === "string" ? release.snapshot_sha256 : (() => { throw new CatalogSnapshotError("REMOTE"); })(),
      expected_service_count: release.expected_service_count === 50 ? 50 : (() => { throw new CatalogSnapshotError("REMOTE"); })(),
    };
    const payload = buildCatalogSnapshotPayload(metadata, read.services, validateHomePolicy(manifest[0], rules));
    const response = await fetcher(`${local.origin}/rest/v1/rpc/caja_import_catalog_snapshot_v1`, { method: "POST", headers: { apikey: local.key, Authorization: `Bearer ${local.key}`, "Content-Type": "application/json", Prefer: "return=representation", "Content-Profile": "public" }, body: JSON.stringify({ p_release: payload.release, p_services: payload.services, p_home_manifest: payload.home_manifest, p_home_rules: payload.home_rules }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new CatalogSnapshotError("LOCAL");
    const result = await response.json() as Record<string, unknown>;
    if (result.release_id !== CATALOG_RELEASE_ID || result.services !== 50 || result.home_rules !== 6 || result.active !== true) throw new CatalogSnapshotError("LOCAL");
    return { source: "canonical", release: CATALOG_RELEASE_ID, services: 50, home_rules: 6, checksum: payload.home_manifest.policy_sha256, status: "SYNCED" as const };
  } catch (error) {
    const safe = asSnapshotError(error);
    if (safe instanceof CatalogSnapshotError) throw safe;
    if (safe instanceof CatalogError) throw new CatalogSnapshotError("REMOTE");
    throw new CatalogSnapshotError("REMOTE");
  }
}

export async function readLocalCatalogSnapshot({ env = process.env, fetcher = fetch }: { env?: SnapshotEnv; fetcher?: Fetcher } = {}) {
  try {
    const catalog = catalogConnection(env);
    const local = localConnection(env, catalog);
    const response = await fetcher(`${local.origin}/rest/v1/rpc/caja_catalog_snapshot_status_v1`, { method: "POST", headers: { apikey: local.key, Authorization: `Bearer ${local.key}`, "Content-Type": "application/json", "Content-Profile": "public" }, body: "{}", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error();
    return await response.json() as Record<string, unknown>;
  } catch { throw new CatalogSnapshotError("LOCAL"); }
}

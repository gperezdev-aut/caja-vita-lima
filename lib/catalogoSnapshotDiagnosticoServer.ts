import "server-only";

import { CatalogSnapshotError } from "./catalogoSnapshot.ts";
import { readLocalCatalogSnapshot, syncCanonicalCatalogSnapshot } from "./catalogoSnapshotServer.ts";

type Session = { rol: string } | null;

function denied(session: Session) {
  return !session ? { status: 401, body: { ok: false, error: "Autenticación requerida." } } :
    { status: 403, body: { ok: false, error: "Solo administradores." } };
}

/** La acción nunca devuelve URL, keys, payload remoto ni detalle de proveedor. */
export async function syncCatalogSnapshotForAdmin(session: Session, sync = syncCanonicalCatalogSnapshot) {
  if (!session || session.rol !== "ADMIN_GERALD") return denied(session);
  try {
    return { status: 200, body: { ok: true, ...(await sync()) } };
  } catch (error) {
    const safe = error instanceof CatalogSnapshotError ? error : new CatalogSnapshotError("LOCAL");
    return { status: safe.code === "DISABLED" ? 409 : 503, body: { ok: false, code: safe.code, error: "No se pudo sincronizar el snapshot canónico." } };
  }
}

export async function diagnoseCatalogSnapshot(session: Session, readLocal = readLocalCatalogSnapshot) {
  if (!session || session.rol !== "ADMIN_GERALD") return denied(session);
  try {
    const local = await readLocal();
    return { status: 200, body: { ok: true, source: "canonical", remote_release: "catalog-v1-web-4104385", remote_services: 50, remote_home_checksum: "c94adc0adb80f56af291221a4363a4ddcd319790af73b64e2c9a42f69dee9bf1", local_active_release: local.release_id ?? null, local_services: local.services ?? 0, local_home_rules: local.home_rules ?? 0, in_sync: local.release_id === "catalog-v1-web-4104385" && local.services === 50 && local.home_policy_sha256 === "c94adc0adb80f56af291221a4363a4ddcd319790af73b64e2c9a42f69dee9bf1" } };
  } catch {
    return { status: 503, body: { ok: false, error: "No se pudo consultar el snapshot local." } };
  }
}

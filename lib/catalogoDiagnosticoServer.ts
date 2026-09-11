import "server-only";

import { CatalogError, summarizeCanonicalCatalog } from "./catalogoCanonico.ts";
import { readCanonicalCatalog } from "./catalogoCanonicoServer.ts";

/** Autorización antes de leer configuración o efectuar consultas. */
export async function diagnoseCatalog(
  session: { rol: string } | null,
  readCatalog = readCanonicalCatalog,
) {
  if (!session) return { status: 401, body: { ok: false, error: "Autenticación requerida." } };
  if (session.rol !== "ADMIN_GERALD") return { status: 403, body: { ok: false, error: "Solo administradores." } };
  try {
    const result = await readCatalog();
    if (result.source === "legacy") {
      return { status: 200, body: { ok: true, source: "legacy", connection: "NOT_CHECKED", message: "Catálogo canónico deshabilitado. Caja conserva el catálogo legacy." } };
    }
    return { status: 200, body: { ok: true, source: "canonical", connection: "OK", ...summarizeCanonicalCatalog(result.services) } };
  } catch (error) {
    const safeError = error instanceof CatalogError ? error : new CatalogError("CONNECTION");
    return { status: 503, body: { ok: false, source: "canonical", connection: "FAILED", code: safeError.code, error: safeError.message } };
  }
}

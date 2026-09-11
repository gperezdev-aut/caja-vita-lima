import "server-only";

import {
  CATALOG_COLUMNS, CATALOG_RELEASE_ID, CATALOG_SERVICE_COUNT, CatalogError,
  validateCanonicalCatalog, type CanonicalService,
} from "./catalogoCanonico.ts";

type CatalogEnvironment = {
  [name: string]: string | undefined;
  CATALOG_SUPABASE_URL?: string;
  CATALOG_SUPABASE_SERVICE_ROLE_KEY?: string;
  CATALOG_CANONICAL_ENABLED?: string;
  CATALOG_EXPECTED_RELEASE_ID?: string;
  CATALOG_EXPECTED_SERVICE_COUNT?: string;
};

export type CanonicalCatalogRead =
  | { source: "legacy"; services: null }
  | { source: "canonical"; services: CanonicalService[] };

/** Solo la cadena exacta "true" habilita la conexión secundaria. */
export function isCanonicalCatalogEnabled(env: CatalogEnvironment = process.env): boolean {
  return env.CATALOG_CANONICAL_ENABLED === "true";
}

function catalogConnection(env: CatalogEnvironment) {
  if (env.CATALOG_EXPECTED_RELEASE_ID !== CATALOG_RELEASE_ID ||
      env.CATALOG_EXPECTED_SERVICE_COUNT !== String(CATALOG_SERVICE_COUNT) ||
      !env.CATALOG_SUPABASE_URL || !env.CATALOG_SUPABASE_SERVICE_ROLE_KEY?.trim()) throw new CatalogError("CONFIGURATION");
  try {
    const url = new URL(env.CATALOG_SUPABASE_URL);
    // Este contrato solo corresponde al staging publicado. Evita enviar la clave
    // a otro proyecto o a una URL con credenciales, query o rutas arbitrarias.
    if (url.origin !== "https://wrbcdmcdxmhdwvftciro.supabase.co" ||
        url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
    return { origin: url.origin, key: env.CATALOG_SUPABASE_SERVICE_ROLE_KEY };
  } catch {
    throw new CatalogError("CONFIGURATION");
  }
}

/** Fase 3A: lectura opt-in. El estado legacy no consulta ni transforma sus precios.
 * No existe recuperación automática a legacy después de habilitar la bandera.
 * Las dependencias opcionales permiten probar sin secretos ni tráfico real.
 */
export async function readCanonicalCatalog({
  env = process.env,
  fetcher = fetch,
}: { env?: CatalogEnvironment; fetcher?: typeof fetch } = {}): Promise<CanonicalCatalogRead> {
  if (!isCanonicalCatalogEnabled(env)) return { source: "legacy", services: null };
  const { origin, key } = catalogConnection(env);
  const query = new URLSearchParams({ select: CATALOG_COLUMNS.join(","), order: "service_code.asc", limit: "51" });
  let payload: unknown;
  try {
    const response = await fetcher(`${origin}/rest/v1/catalog_services_read_v1?${query}`, {
      method: "GET",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "public", Prefer: "count=exact" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new CatalogError("CONNECTION");
    // count=exact detecta incluso 50 filas truncadas de un catálogo mayor.
    if (response.headers.get("content-range") !== "0-49/50") throw new CatalogError("COUNT");
    try {
      payload = await response.json();
    } catch {
      throw new CatalogError("RESPONSE");
    }
  } catch (error) {
    // No propagar cuerpo HTTP, URL, claves, mensajes del proveedor ni causas.
    if (error instanceof CatalogError) throw error;
    throw new CatalogError("CONNECTION");
  }
  return { source: "canonical", services: validateCanonicalCatalog(payload) };
}

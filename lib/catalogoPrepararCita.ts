import "server-only";

import { supabaseRpc } from "@/lib/supabaseServer";
import {
  parsearPoliticasHome,
  parsearSnapshotServicios,
  type CatalogoCitaServicio,
  type PoliticaHome,
} from "@/lib/catalogoPrepararCitaDominio";

type Row = Record<string, unknown>;

type CatalogoResult =
  | { ok: true; services: CatalogoCitaServicio[]; homePolicies: PoliticaHome[]; releaseId: string }
  | { ok: false; error: string };

export async function leerCatalogoPrepararCita(): Promise<CatalogoResult> {
  const [servicesResult, homeResult] = await Promise.all([
    supabaseRpc<Row[]>("caja_catalog_active_services_read_v1", {}),
    supabaseRpc<Row[]>("caja_catalog_home_policy_read_v1", {}),
  ]);
  const error = servicesResult.error || homeResult.error;
  if (error) return { ok: false as const, error: `No se pudo leer el snapshot canónico local: ${error}` };
  const parsedServices = parsearSnapshotServicios(servicesResult.data ?? []);
  if (!parsedServices.ok) return { ok: false, error: parsedServices.error };
  const parsedPolicies = parsearPoliticasHome(homeResult.data ?? [], parsedServices.releaseId);
  if (!parsedPolicies.ok) return { ok: false, error: parsedPolicies.error };
  return { ok: true as const, services: parsedServices.services, homePolicies: parsedPolicies.policies, releaseId: parsedServices.releaseId };
}

import { requireModuleAccess } from "@/lib/auth";
import { CajaSidebar } from "@/components/CajaSidebar";
import { supabaseSelect } from "@/lib/supabaseServer";
import { createAtencionAction } from "./actions";
import { NuevaAtencionWizard } from "./NuevaAtencionWizard";

type Row = Record<string, unknown>;

type SearchParams = Promise<{
  ok?: string;
  id?: string;
  error?: string;
}>;

type CatalogService = {
  codeId: string;
  name: string;
  category: string;
  duration: number;
  price: number;
  paxType: string;
  sortOrder: number;
};

type Promotion = {
  code: string;
  name: string;
  headline: string;
  duration: number;
  price1p: number;
  price2p: number;
  includes: string;
};

function todayInLima() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function currentTimeInLima() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Lima",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function list(config: Row[], name: string, fallback: string[]) {
  const values = config
    .filter((row) => row.lista === name && row.activo !== false)
    .sort((a, b) => Number(a.orden ?? 0) - Number(b.orden ?? 0))
    .map((row) => String(row.valor ?? "").trim())
    .filter(Boolean);

  return values.length ? values : fallback;
}

function parseNumber(value: unknown) {
  const cleaned = String(value ?? "")
    .replace(/S\//gi, "")
    .replace(/\s/g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function truthy(value: unknown) {
  return ["true", "1", "yes", "si", "sí"].includes(
    String(value ?? "").trim().toLowerCase()
  );
}

function normalizeServices(rows: Row[]): CatalogService[] {
  return rows
    .filter((row) => truthy(row.active))
    .map((row) => ({
      codeId: String(row.CodeId ?? "").trim(),
      name: String(row.option_name ?? "").trim(),
      category: String(row.category ?? "").trim(),
      duration: parseNumber(row.duration_min),
      price: parseNumber(row.price_pen ?? row.price),
      paxType: String(row.pax_type ?? row.category ?? "").trim(),
      sortOrder: parseNumber(row.sort_order),
    }))
    .filter((row) => row.codeId && row.name)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

function normalizePromotions(rows: Row[]): Promotion[] {
  const today = todayInLima();

  return rows
    .filter((row) => {
      if (!truthy(row.is_active)) return false;
      const start = String(row.start_date ?? "").slice(0, 10);
      const end = String(row.end_date ?? "").slice(0, 10);
      return (!start || start <= today) && (!end || end >= today);
    })
    .map((row) => ({
      code: String(row.promo_code ?? "").trim(),
      name: String(row.promo_name ?? "").trim(),
      headline: String(row.headline_text ?? row.promo_name ?? "").trim(),
      duration: parseNumber(row.duration_min),
      price1p: parseNumber(row.price_1p),
      price2p: parseNumber(row.price_2p),
      includes: String(row.includes_text ?? "").trim(),
    }))
    .filter((row) => row.code && row.name);
}

function canSaveServices(session: unknown) {
  const role = String(
    (session as Record<string, unknown>)?.role ??
    (session as Record<string, unknown>)?.rol ??
    ""
  ).toUpperCase();

  return ["ADMIN_GERALD", "ADMIN", "ADMINISTRADOR"].includes(role);
}

export default async function NuevaAtencionPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireModuleAccess("nueva-atencion");
  const params = await searchParams;

  const [config, catalog, promotionsResult] = await Promise.all([
    supabaseSelect<Row>("config_listas"),
    supabaseSelect<Row>("stg_services_catalog_v5"),
    supabaseSelect<Row>("stg_promotions_v1"),
  ]);

  const services = normalizeServices(catalog.data);
  const promotions = normalizePromotions(promotionsResult.data);

  return (
    <main className="appShell">
      <CajaSidebar session={session} />

      <section className="page nuevaAtencionPage">
        <section className="hero nuevaAtencionHero">
          <div>
            <p className="eyebrow">Operación guiada</p>
            <h1>Nueva atención</h1>
            <p className="subtitle">
              Completa cada bloque con calma y revisa el resumen antes de guardar.
            </p>
          </div>

          <div className="badge">
            <span>Catálogo</span>
            <strong>{services.length} opciones activas</strong>
          </div>
        </section>

        {params?.ok && (
          <div className="formMessage ok">
            Registro guardado correctamente. Movimiento: <strong>{params.id}</strong>
          </div>
        )}

        {params?.error && (
          <div className="formMessage error">
            <strong>No se pudo guardar:</strong> {params.error}
          </div>
        )}

        {(config.error || catalog.error || promotionsResult.error) && (
          <div className="alert">
            <strong>Revisar conexión con Supabase.</strong>
          </div>
        )}

        <form action={createAtencionAction} className="atencionForm">
          <NuevaAtencionWizard
            services={services}
            promotions={promotions}
            sedes={list(config.data, "SEDES", ["Miraflores", "San Borja"])}
            metodos={list(config.data, "METODOS_PAGO", ["EFECTIVO", "YAPE", "PLIN", "IZIPAY POS", "BCP", "OTRO"])}
            terapistas={list(config.data, "TERAPISTAS", ["Rossana", "Maria E", "Melissa", "Cecilia", "Otro"])}
            estadosBoleta={list(config.data, "ESTADO_BOLETA", ["Emitida", "Pendiente", "No aplica", "Anulada"])}
            responsables={list(config.data, "RESPONSABLES", ["Gerald", "Luis", "Naty", "Otro"])}
            defaultDate={todayInLima()}
            defaultTime={currentTimeInLima()}
            canSaveCatalog={canSaveServices(session)}
          />
        </form>
      </section>
    </main>
  );
}

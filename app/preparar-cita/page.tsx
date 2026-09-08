import { CajaSidebar } from "@/components/CajaSidebar";
import { requireModuleAccess } from "@/lib/auth";
import { supabaseSelect } from "@/lib/supabaseServer";
import { PrepararCitaForm } from "./PrepararCitaForm";

type Row = Record<string, unknown>;

function number(value: unknown) {
  const parsed = Number(
    String(value ?? "")
      .replace(/S\//gi, "")
      .replace(/\s/g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "")
  );
  return Number.isFinite(parsed) ? parsed : 0;
}

function truthy(value: unknown) {
  return ["true", "1", "yes", "si", "sí"].includes(
    String(value ?? "").trim().toLowerCase()
  );
}
function todayInLima() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default async function PrepararCitaPage() {
  const session = await requireModuleAccess("preparar-cita");
  const [catalogResult, promotionsResult, sedesResult, configResult] =
    await Promise.all([
      supabaseSelect<Row>("stg_services_catalog_v5"),
      supabaseSelect<Row>("stg_promotions_v1"),
      supabaseSelect<Row>("sedes"),
      supabaseSelect<Row>("config_listas"),
    ]);

  const services = catalogResult.data
    .filter((row) => truthy(row.active))
    .map((row) => ({
      code: String(row.CodeId ?? "").trim(),
      name: String(row.option_name ?? "").trim(),
      duration: Math.round(number(row.duration_min)),
      price: number(row.price_pen ?? row.price),
      paxType: String(row.pax_type ?? row.category ?? "").trim().toLowerCase(),
      sortOrder: number(row.sort_order),
    }))
    .filter((row) => row.code && row.name && row.duration > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  const today = todayInLima();
  const promotions = promotionsResult.data
    .filter((row) => {
      const start = String(row.start_date ?? "").slice(0, 10);
      const end = String(row.end_date ?? "").slice(0, 10);
      return truthy(row.is_active) && (!start || start <= today) && (!end || end >= today);
    })
    .map((row) => ({
      code: String(row.promo_code ?? "").trim(),
      name: String(row.promo_name ?? "").trim(),
      price1: number(row.price_1p),
      price2: number(row.price_2p),
    }))
    .filter((row) => row.code && row.name);

  const sedes = sedesResult.data
    .filter((row) => row.activo !== false)
    .map((row) => ({
      name: String(row.nombre ?? "").trim(),
      open: String(row.hora_apertura ?? "").slice(0, 5),
      close: String(row.hora_cierre ?? "").slice(0, 5),
    }))
    .filter((row) => row.name && row.open && row.close);

  const metodos = configResult.data
    .filter((row) => row.lista === "METODOS_PAGO" && row.activo !== false)
    .sort((a, b) => Number(a.orden ?? 0) - Number(b.orden ?? 0))
    .map((row) => String(row.valor ?? "").trim())
    .filter(Boolean);

  const error =
    catalogResult.error || promotionsResult.error || sedesResult.error || configResult.error;

  return (
    <main className="appShell">
      <CajaSidebar session={session} />
      <section className="page nuevaAtencionPage">
        <section className="hero nuevaAtencionHero">
          <div>
            <p className="eyebrow">Ficha de cita</p>
            <h1>Preparar cita</h1>
            <p className="subtitle">
              Guarda la reserva y el pago juntos; el enlace aparece únicamente al confirmar la operación.
            </p>
          </div>
          <div className="badge">
            <span>Servicios activos</span>
            <strong>{services.length}</strong>
          </div>
        </section>

        {error ? (
          <div className="formMessage error" role="alert">
            No se puede preparar una cita: {error}
          </div>
        ) : (
          <PrepararCitaForm
            services={services}
            promotions={promotions}
            sedes={sedes}
            metodos={metodos.length ? metodos : ["YAPE", "PLIN", "TRANSFERENCIA", "EFECTIVO"]}
            minDate={today}
          />
        )}
      </section>
    </main>
  );
}

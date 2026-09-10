import { randomUUID } from "crypto";
import { getCountries, getCountryCallingCode } from "libphonenumber-js/max";
import { CajaSidebar } from "@/components/CajaSidebar";
import { requireModuleAccess } from "@/lib/auth";
import { precioCatalogoActivo } from "@/lib/fichaCitaDominio";
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
  const [catalogResult, sedesResult, configResult] =
    await Promise.all([
      supabaseSelect<Row>("stg_services_catalog_v5"),
      supabaseSelect<Row>("sedes"),
      supabaseSelect<Row>("config_listas"),
    ]);

  const services = catalogResult.data
    .filter((row) => truthy(row.active))
    .map((row) => ({
      code: String(row.CodeId ?? "").trim(),
      name: String(row.option_name ?? "").trim(),
      duration: Math.round(number(row.duration_min)),
      price: precioCatalogoActivo(row.price_pen, row.price),
      paxType: String(row.pax_type ?? row.category ?? "").trim().toLowerCase(),
      sortOrder: number(row.sort_order),
    }))
    .filter((row) => row.code && row.name && row.duration > 0 && row.price > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  const today = todayInLima();

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
    catalogResult.error || sedesResult.error || configResult.error ||
    (!metodos.length ? "No hay métodos de pago activos configurados." : "");
  const regionNames = new Intl.DisplayNames(["es"], { type: "region" });
  const countries = getCountries()
    .map((code) => ({ code, name: regionNames.of(code) ?? code, callingCode: getCountryCallingCode(code) }))
    .sort((a, b) => (a.code === "PE" ? -1 : b.code === "PE" ? 1 : a.name.localeCompare(b.name, "es")));

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
            sedes={sedes}
            metodos={metodos}
            countries={countries}
            requestId={randomUUID()}
            minDate={today}
          />
        )}
      </section>
    </main>
  );
}

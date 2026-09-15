import { randomUUID } from "crypto";
import { getCountries, getCountryCallingCode } from "libphonenumber-js/max";
import { CajaSidebar } from "@/components/CajaSidebar";
import { requireModuleAccess } from "@/lib/auth";
import { leerCatalogoPrepararCita } from "@/lib/catalogoPrepararCita";
import { supabaseRpc, supabaseSelect, supabaseSelectWhere } from "@/lib/supabaseServer";
import { PrepararCitaForm, type GiftCardAppointmentContext } from "./PrepararCitaForm";
import { serviceDisplayName } from "./prepararCitaWizard";

type Row = Record<string, unknown>;

function todayInLima() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default async function PrepararCitaPage({ searchParams }: { searchParams: Promise<{ giftcard_id?: string }> }) {
  const session = await requireModuleAccess("preparar-cita");
  const giftcardId = String((await searchParams).giftcard_id ?? "").trim();
  const [catalogResult, sedesResult, configResult] =
    await Promise.all([
      leerCatalogoPrepararCita(),
      supabaseSelect<Row>("sedes"),
      supabaseSelect<Row>("config_listas"),
    ]);

  const services = catalogResult.ok
    ? catalogResult.services.map((service) => ({
        code: service.serviceCode,
        name: serviceDisplayName(service.nameEs),
        duration: service.durationMin,
        price: service.pricePen,
        category: service.category,
        modality: service.modality,
        peopleMin: service.peopleMin,
        peopleMax: service.peopleMax,
        selectionRule: service.selectionRule,
        reservationBehavior: service.reservationBehavior,
      })).sort((a, b) => a.name.localeCompare(b.name, "es"))
    : [];
  const homePolicies = catalogResult.ok ? catalogResult.homePolicies : [];

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

  let giftCard: GiftCardAppointmentContext | null = null;
  let giftCardError = "";
  if (giftcardId) {
    const cardResult = await supabaseSelectWhere<Row>("vista_gift_cards_operativa", `select=giftcard_id,codigo,tipo,destinatario,whatsapp_beneficiario,service_code,service_name_snapshot,service_duration_min,service_price_pen,catalog_release_id,catalog_price_version,estado_efectivo,saldo_disponible&giftcard_id=eq.${encodeURIComponent(giftcardId)}&limit=1`);
    const card = cardResult.data[0];
    if (cardResult.error || !card) giftCardError = cardResult.error || "La Gift Card no existe.";
    else if (!["EMITIDA", "PARCIALMENTE_USADA"].includes(String(card.estado_efectivo)) || Number(card.saldo_disponible ?? 0) <= 0) giftCardError = "La Gift Card no está disponible para una nueva reserva.";
    else {
      let lockedService: GiftCardAppointmentContext["lockedService"] = null;
      if (card.tipo === "SERVICIO") {
        const historical = await supabaseRpc<Row[]>("caja_gift_card_catalog_appointment_history_v1", { p_service_code: String(card.service_code ?? ""), p_release_id: String(card.catalog_release_id ?? ""), p_price_version: String(card.catalog_price_version ?? "") });
        const rows = historical.data ?? [];
        const service = rows[0];
        if (historical.error || rows.length !== 1 || !service) giftCardError = "No se pudo resolver exactamente el servicio histórico de la Gift Card.";
        else lockedService = { code: String(service.service_code), name: serviceDisplayName(String(card.service_name_snapshot ?? service.name_es)), duration: Number(card.service_duration_min ?? service.duration_min), price: Number(card.service_price_pen ?? service.price_pen), category: String(service.category), modality: String(service.modality), peopleMin: Number(service.people_min), peopleMax: Number(service.people_max), selectionRule: String(service.selection_rule), reservationBehavior: String(service.reservation_behavior) };
      }
      if (!giftCardError) giftCard = { id: giftcardId, code: String(card.codigo), type: String(card.tipo) as "SERVICIO" | "MONTO", beneficiary: String(card.destinatario ?? ""), phone: String(card.whatsapp_beneficiario ?? ""), available: Number(card.saldo_disponible ?? 0), lockedService };
    }
  }

  const error =
    ("error" in catalogResult ? catalogResult.error : "") || sedesResult.error || configResult.error ||
    giftCardError || (!metodos.length ? "No hay métodos de pago activos configurados." : "");
  const regionNames = new Intl.DisplayNames(["es"], { type: "region" });
  const countries = getCountries()
    .map((code) => ({ code, name: regionNames.of(code) ?? code, callingCode: getCountryCallingCode(code) }))
    .sort((a, b) => (a.code === "PE" ? -1 : b.code === "PE" ? 1 : a.name.localeCompare(b.name, "es")));

  return (
    <main className="appShell">
      <CajaSidebar session={session} />
      <section className="page nuevaAtencionPage prepararCitaPage">
        <section className="hero nuevaAtencionHero prepararCitaHero">
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
            homePolicies={homePolicies}
            sedes={sedes}
            metodos={metodos}
            countries={countries}
            requestId={randomUUID()}
            minDate={today}
            giftCard={giftCard}
          />
        )}
      </section>
    </main>
  );
}

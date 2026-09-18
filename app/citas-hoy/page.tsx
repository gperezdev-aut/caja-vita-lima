import { requireModuleAccess } from "@/lib/auth";
import { CajaSidebar } from "@/components/CajaSidebar";
import { supabaseSelect, supabaseSelectWhere } from "@/lib/supabaseServer";
import { displayText } from "@/lib/displayText";
import { Badge } from "@/components/Badge";
import { FormField } from "@/components/FormField";
import { Input } from "@/components/Input";
import { Select } from "@/components/Select";

type Row = Record<string, any>;
type SearchParams = Promise<{ fecha?: string; sede?: string }>;

function money(value: any) {
  return `S/ ${Number(value ?? 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function todayInLima() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}-${parts.find((p) => p.type === "day")?.value}`;
}

function isValidDateInput(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function normalizeSede(value: string | undefined, validSedes: string[]) {
  if (value === "TODAS") return value;
  if (value && validSedes.includes(value)) return value;
  return "TODAS";
}

function list(config: Row[], name: string) {
  return config.filter((row) => row.lista === name && row.activo !== false).sort((a, b) => Number(a.orden ?? 0) - Number(b.orden ?? 0));
}

function Options({ rows, fallback }: { rows: Row[]; fallback: string[] }) {
  const values = rows.length ? rows.map((row) => String(row.valor)) : fallback;
  return <>{values.map((value) => <option key={value} value={value}>{value}</option>)}</>;
}

function dateLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("es-PE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}

function hourLabel(value: any) {
  return value ? String(value).slice(0, 5) : "-";
}

function waHref(value: any) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return `https://wa.me/${digits.length === 9 ? `51${digits}` : digits}`;
}

function normalizeService(value: unknown) {
  return displayText(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function shortText(value: unknown, max = 95) {
  const text = String(value ?? "").trim();
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function AlertaBadge({ alerta }: { alerta: string }) {
  if (!alerta) return null;
  return <Badge tone="danger" title={alerta}>⚠ Alerta cliente</Badge>;
}

type ServiceInfo = { included: string; duration: number };
type CitaPresentation = {
  row: Row;
  movimientoId: string;
  terapistas: string;
  pendiente: number;
  comprobante: string;
  alerta: string;
  puedeAtender: boolean;
  esDirecta: boolean;
  coberturaGiftCard: number;
  serviceInfo?: ServiceInfo;
};

function ActionLabel({ cita }: { cita: CitaPresentation }) {
  if (cita.row.estado === "En atención") return <>Continuar</>;
  if (cita.esDirecta) return <>Completar</>;
  return <>Iniciar atención</>;
}

function CitaMobileCard({ cita, showTechnical }: { cita: CitaPresentation; showTechnical: boolean }) {
  const { row, movimientoId, terapistas, pendiente, comprobante, alerta, puedeAtender, coberturaGiftCard, serviceInfo } = cita;
  const comprobanteOk = comprobante.toUpperCase().includes("OK");
  const pagadoCompleto = pendiente <= 0.009;
  return (
    <article className="citasHoyCard citasHoyCardCompact">
      <div className="citasHoyCardHeader">
        <div>
          <strong className="citasHoyCardHour">{hourLabel(row.hora)}</strong>
          <h3>{row.cliente}</h3>
        </div>
        <Badge>{row.estado || "-"}</Badge>
      </div>

      <div className="citasHoyCardIdentity">
        <p className="citasHoyCardService"><strong>{displayText(row.servicio)}</strong></p>
        {serviceInfo && <small>{serviceInfo.duration ? `${serviceInfo.duration} min` : ""}{serviceInfo.duration && serviceInfo.included ? " · " : ""}{shortText(serviceInfo.included, 92)}</small>}
        <p className="citasHoyCardOperationalMeta">{terapistas} · {row.sede}</p>
        {alerta && <div style={{ marginTop: 7 }}><AlertaBadge alerta={alerta} /></div>}
      </div>

      <div className={`citasHoyPaymentSummary ${pagadoCompleto ? "isPaid" : "hasPending"}`}>
        <div className="citasHoyPaymentPrimary">
          <span>{pagadoCompleto ? "Pago" : "Pendiente"}</span>
          <strong>{pagadoCompleto ? "Completo" : money(row.pendiente)}</strong>
        </div>
        <div className="citasHoyPaymentSecondary">
          <span>Total {money(row.total_cobrar)}</span>
          <span>Pagado {money(row.total_pagado)}</span>
          {coberturaGiftCard > 0 && <span>Gift Card {money(coberturaGiftCard)}</span>}
        </div>
      </div>

      <div className="citasHoyCardStatusLine">
        <span>Comprobante</span>
        <Badge tone={comprobanteOk ? "good" : "warn"}>{comprobante}</Badge>
      </div>

      <div className="citasHoyCardActions citasHoyCardActionsCompact">
        {row.whatsapp && <a className="citasHoyWhatsappButton" href={waHref(row.whatsapp)} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
        {puedeAtender && <a className="citasHoyStartButton" href={`/citas-hoy/${encodeURIComponent(movimientoId)}/atencion`}><ActionLabel cita={cita} /></a>}
      </div>
      {showTechnical && <details className="technicalDetails"><summary>Referencia interna</summary><code>{movimientoId}</code></details>}
    </article>
  );
}

export default async function CitasHoyPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireModuleAccess("citas-hoy");
  const showTechnical = session.rol !== "VITA_OPERACION";
  const params = await searchParams;

  const config = await supabaseSelect<Row>("config_listas");
  const sedeFallback = ["Miraflores", "San Borja"];
  const sedesRows = list(config.data, "SEDES");
  const sedeValues = sedesRows.length ? sedesRows.map((row) => String(row.valor)) : sedeFallback;
  const selectedFecha = isValidDateInput(params?.fecha) ? String(params.fecha) : todayInLima();
  const selectedSede = normalizeSede(params?.sede, sedeValues);
  const sedeLabel = selectedSede === "TODAS" ? "todas las sedes" : selectedSede;

  const movimientosQuery = [
    "select=movimiento_id,fecha,hora,sede,cliente_id,cliente,whatsapp,n_pax,servicio,total_cobrar,total_pagado,pendiente,estado,estado_boleta,tipo_comprobante,estado_comprobante_manual,tipo_movimiento,source_type,source_id,created_at",
    `fecha=eq.${selectedFecha}`,
  ];
  const detallesQuery = ["select=movimiento_id,fecha,sede,persona_n,terapista,servicio,duracion,monto_asignado", `fecha=eq.${selectedFecha}`];
  const reservasQuery = ["select=reserva_id,source_id,cliente_id,estado,requiere_confirmacion,confirmado_en", `fecha_cita=eq.${selectedFecha}`];
  if (selectedSede !== "TODAS") {
    const encodedSede = encodeURIComponent(selectedSede);
    movimientosQuery.push(`sede=eq.${encodedSede}`);
    detallesQuery.push(`sede=eq.${encodedSede}`);
    reservasQuery.push(`sede=eq.${encodedSede}`);
  }
  movimientosQuery.push("order=hora.asc");
  detallesQuery.push("order=persona_n.asc");
  reservasQuery.push("order=hora_cita.asc");

  const [movimientos, detalles, reservas, holds, releaseResult] = await Promise.all([
    supabaseSelectWhere<Row>("caja_movimientos", movimientosQuery.join("&")),
    supabaseSelectWhere<Row>("caja_atencion_detalle", detallesQuery.join("&")),
    supabaseSelectWhere<Row>("citas_reservadas", reservasQuery.join("&")),
    supabaseSelectWhere<Row>("gift_card_reservas", "select=movimiento_id,monto_reservado,estado&estado=in.(ACTIVA,CANJEADA)"),
    supabaseSelectWhere<Row>("caja_catalog_releases", "select=release_id&active=eq.true&limit=1"),
  ]);

  let catalogError: string | null = null;
  let catalogServices: Row[] = [];
  const releaseId = String(releaseResult.data[0]?.release_id ?? "");
  if (releaseId) {
    const catalog = await supabaseSelectWhere<Row>("caja_catalog_services", `select=name_es,included_es,duration_min&release_id=eq.${encodeURIComponent(releaseId)}&active=eq.true`);
    catalogServices = catalog.data;
    catalogError = catalog.error;
  }
  const serviceByName = new Map<string, ServiceInfo>();
  for (const service of catalogServices) serviceByName.set(normalizeService(service.name_es), { included: displayText(service.included_es ?? ""), duration: Number(service.duration_min ?? 0) });

  const whatsappList = Array.from(new Set(movimientos.data.map((row) => String(row.whatsapp ?? "").trim()).filter(Boolean)));
  const alertasResult = whatsappList.length
    ? await supabaseSelectWhere<Row>("vista_clientes_crm_catalogo", ["select=whatsapp,alerta_atencion", `whatsapp=in.(${whatsappList.map((value) => encodeURIComponent(value)).join(",")})`].join("&"))
    : { data: [] as Row[], error: null };
  const alertaPorWhatsapp = new Map<string, string>();
  for (const row of alertasResult.data) {
    const whatsapp = String(row.whatsapp ?? "").trim();
    const alerta = String(row.alerta_atencion ?? "").trim();
    if (whatsapp && alerta) alertaPorWhatsapp.set(whatsapp, alerta);
  }

  const errors = [config.error, movimientos.error, detalles.error, reservas.error, holds.error, releaseResult.error, catalogError, alertasResult.error].filter(Boolean);
  const detallePorMovimiento = new Map<string, Row[]>();
  const reservaPorId = new Map(reservas.data.map((row) => [String(row.reserva_id ?? ""), row]));
  const holdPorMovimiento = new Map(holds.data.map((row) => [String(row.movimiento_id ?? ""), row]));
  for (const detalle of detalles.data) {
    const id = String(detalle.movimiento_id ?? "");
    detallePorMovimiento.set(id, [...(detallePorMovimiento.get(id) ?? []), detalle]);
  }

  const totalCobrar = movimientos.data.reduce((sum, row) => sum + Number(row.total_cobrar ?? 0), 0);
  const totalPagado = movimientos.data.reduce((sum, row) => sum + Number(row.total_pagado ?? 0), 0);
  const totalPendiente = movimientos.data.reduce((sum, row) => sum + Number(row.pendiente ?? 0), 0);

  const citas: CitaPresentation[] = movimientos.data.map((row) => {
    const movimientoId = String(row.movimiento_id ?? "");
    const detalleRows = detallePorMovimiento.get(movimientoId) ?? [];
    const terapistas = detalleRows.length ? detalleRows.map((detalle) => detalle.terapista).filter(Boolean).join(" / ") : "Por asignar";
    const pendiente = Number(row.pendiente ?? 0);
    const comprobante = String(row.estado_comprobante_manual || row.estado_boleta || row.tipo_comprobante || "-");
    const alerta = alertaPorWhatsapp.get(String(row.whatsapp ?? "").trim()) ?? "";
    const reserva = reservaPorId.get(String(row.source_id ?? ""));
    const reservaRelacionada = Boolean(reserva && reserva.source_id === movimientoId && reserva.cliente_id === row.cliente_id && (reserva.requiere_confirmacion !== true || Boolean(reserva.confirmado_en)));
    const puedeAtenderReserva = reservaRelacionada && ((row.tipo_movimiento === "RESERVA_APP" && row.estado === "Reservado" && reserva?.estado === "PENDIENTE") || (row.tipo_movimiento === "ATENCION_APP" && row.estado === "En atención" && reserva?.estado === "EN_ATENCION"));
    const esDirecta = row.tipo_movimiento === "ATENCION_APP" && !reserva;
    const puedeAtenderDirecta = esDirecta && (row.estado === "Registrado" || row.estado === "En atención");
    return {
      row,
      movimientoId,
      terapistas,
      pendiente,
      comprobante,
      alerta,
      puedeAtender: puedeAtenderReserva || puedeAtenderDirecta,
      esDirecta,
      coberturaGiftCard: Number(holdPorMovimiento.get(movimientoId)?.monto_reservado ?? 0),
      serviceInfo: serviceByName.get(normalizeService(row.servicio)),
    };
  });

  return (
    <main className="appShell">
      <CajaSidebar session={session} />
      <section className="page citasHoyPage">
        <section className="hero" style={{ minHeight: 150 }}>
          <div><p className="eyebrow">Operación diaria</p><h1>Citas de hoy</h1><p className="subtitle">Atenciones y reservas registradas para {dateLabel(selectedFecha)} en {sedeLabel}.</p></div>
          <div className="badge"><span>Registros</span><strong>{movimientos.data.length}</strong></div>
        </section>

        <section className="panel" style={{ padding: 20, marginBottom: 22 }}>
          <div className="panelTitle"><div><h2>Filtros</h2><p>Consulta citas por fecha y sede sin salir del módulo.</p></div></div>
          <form className="citasHoyFilters" method="GET" action="/citas-hoy" style={{ display: "grid" }}>
            <FormField label="Fecha"><Input name="fecha" type="date" defaultValue={selectedFecha} /></FormField>
            <FormField label="Sede"><Select name="sede" defaultValue={selectedSede}><option value="TODAS">Todas las sedes</option><Options rows={sedesRows} fallback={sedeFallback} /></Select></FormField>
            <div className="citasHoyFilterActions">
              <button className="citasHoyFilterButton primaryButton" type="submit">Aplicar filtros</button>
              <a className="citasHoyFilterButton ghostButton" href="/citas-hoy">Ver hoy</a>
            </div>
          </form>
        </section>

        {errors.length > 0 && (showTechnical
          ? <div className="alert"><strong>Revisar conexión:</strong><ul>{errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div>
          : <div className="alert"><strong>No se pudo cargar parte del detalle operativo.</strong><p>Puedes seguir trabajando; administración puede revisar el detalle técnico.</p></div>
        )}

        <section className="grid secondary">
          <div className="card good"><span>Total a cobrar</span><strong>{money(totalCobrar)}</strong></div>
          <div className="card good"><span>Total pagado</span><strong>{money(totalPagado)}</strong></div>
          <div className="card warn"><span>Pendiente</span><strong>{money(totalPendiente)}</strong></div>
          <div className="card"><span>Cantidad</span><strong>{movimientos.data.length}</strong></div>
        </section>

        <section className="panel">
          <div className="panelTitle citasHoyAgendaTitle">
            <div><h2>Agenda operativa</h2><p>Cliente, servicio, terapista, cobro y acción en una sola vista.</p></div>
            <div className="citasHoyActions">
              <a className="citasHoyAction" href="/nueva-atencion" style={{ background: "var(--brand-primary)", color: "var(--brand-primary-text)", borderRadius: 16, padding: "13px 16px", fontWeight: 850, textDecoration: "none", whiteSpace: "nowrap" }}>Nueva atención</a>
              <a className="citasHoyAction" href="/registrar-salida" style={{ background: "white", color: "var(--charcoal)", border: "1px solid var(--line)", borderRadius: 16, padding: "13px 16px", fontWeight: 850, textDecoration: "none", whiteSpace: "nowrap" }}>Registrar salida</a>
            </div>
          </div>

          {movimientos.data.length === 0 ? <div className="alert" style={{ marginBottom: 0 }}>No hay citas o atenciones registradas para la fecha y sede seleccionadas.</div> : (
            <>
              <div className="tableWrap citasHoyDesktopTable">
                <table>
                  <thead><tr><th>Hora</th><th>Cliente</th><th>Servicio</th><th>Terapista</th><th>Cobro</th><th>Estado</th>{showTechnical && <th>Ref.</th>}<th>Acción</th></tr></thead>
                  <tbody>{citas.map((cita) => {
                    const { row, movimientoId, terapistas, pendiente, comprobante, alerta, puedeAtender, coberturaGiftCard, serviceInfo } = cita;
                    return (
                      <tr key={movimientoId}>
                        <td><strong>{hourLabel(row.hora)}</strong></td>
                        <td className="strong">
                          <div>{row.cliente}</div>
                          {row.whatsapp && <a href={waHref(row.whatsapp)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--green)", fontSize: 12 }}>{row.whatsapp}</a>}
                          {alerta && <div style={{ marginTop: 5 }}><AlertaBadge alerta={alerta} /></div>}
                        </td>
                        <td style={{ minWidth: 220 }}>
                          <strong>{displayText(row.servicio)}</strong>
                          {serviceInfo && <small style={{ display: "block", marginTop: 4, color: "var(--muted)", maxWidth: 330 }}>{serviceInfo.duration ? `${serviceInfo.duration} min` : ""}{serviceInfo.duration && serviceInfo.included ? " · " : ""}{shortText(serviceInfo.included, 72)}</small>}
                          {selectedSede === "TODAS" && <small style={{ display: "block", marginTop: 3 }}>{row.sede}</small>}
                        </td>
                        <td>{terapistas}</td>
                        <td style={{ minWidth: 150 }}>
                          <div><small>Total</small> <strong>{money(row.total_cobrar)}</strong></div>
                          <div><small>Pagado</small> {money(row.total_pagado)}</div>
                          {coberturaGiftCard > 0 && <div><small>Gift Card</small> {money(coberturaGiftCard)}</div>}
                          <Badge tone={pendiente > 0 ? "warn" : "good"}>Pendiente {money(row.pendiente)}</Badge>
                        </td>
                        <td><Badge>{row.estado || "-"}</Badge><div style={{ marginTop: 6 }}><Badge tone={comprobante.toUpperCase().includes("OK") ? "good" : "warn"}>Comprobante: {comprobante}</Badge></div></td>
                        {showTechnical && <td><details className="technicalDetails"><summary>Ver</summary><code>{movimientoId}</code></details></td>}
                        <td>{puedeAtender ? <a className="citasHoyTableAction" href={`/citas-hoy/${encodeURIComponent(movimientoId)}/atencion`}><ActionLabel cita={cita} /></a> : "-"}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
              <div className="citasHoyMobileList">{citas.map((cita) => <CitaMobileCard key={cita.movimientoId} cita={cita} showTechnical={showTechnical} />)}</div>
            </>
          )}
        </section>
      </section>
    </main>
  );
}

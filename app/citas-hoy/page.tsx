import { requireModuleAccess } from "@/lib/auth";
import { CajaSidebar } from "@/components/CajaSidebar";
import { supabaseSelect, supabaseSelectWhere } from "@/lib/supabaseServer";

type Row = Record<string, any>;

type SearchParams = Promise<{
  fecha?: string;
  sede?: string;
}>;

const fieldStyle = {
  display: "grid",
  gap: "8px",
  color: "var(--muted)",
  fontSize: "13px",
  fontWeight: 800,
};

const inputStyle = {
  width: "100%",
  border: "1px solid var(--line)",
  borderRadius: "15px",
  background: "#fffaf4",
  color: "var(--text)",
  padding: "13px 14px",
  outline: "none",
};

function money(value: any) {
  const numberValue = Number(value ?? 0);

  return `S/ ${numberValue.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function todayInLima() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;

  return `${y}-${m}-${d}`;
}

function isValidDateInput(value: string | undefined) {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeSede(value: string | undefined, validSedes: string[]) {
  if (value === "TODAS") return value;
  if (value && validSedes.includes(value)) return value;

  return "TODAS";
}

function list(config: Row[], name: string) {
  return config
    .filter((row) => row.lista === name && row.activo !== false)
    .sort((a, b) => Number(a.orden ?? 0) - Number(b.orden ?? 0));
}

function Options({
  rows,
  fallback,
}: {
  rows: Row[];
  fallback: string[];
}) {
  const values = rows.length ? rows.map((row) => String(row.valor)) : fallback;

  return (
    <>
      {values.map((value) => (
        <option key={value} value={value}>
          {value}
        </option>
      ))}
    </>
  );
}

function dateLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);

  return date.toLocaleDateString("es-PE", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function hourLabel(value: any) {
  if (!value) return "-";
  return String(value).slice(0, 5);
}

function waHref(value: any) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length > 9 && digits.startsWith("51")) {
    digits = digits.slice(2);
  }
  digits = digits.slice(-9);
  return `https://wa.me/51${digits}`;
}

function Badge({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "good" | "warn";
}) {
  const styles: Record<string, React.CSSProperties> = {
    default: {
      background: "white",
      color: "var(--text)",
      border: "1px solid var(--line)",
    },
    good: {
      background: "var(--green-soft)",
      color: "var(--green)",
      border: "1px solid rgba(31, 107, 79, 0.18)",
    },
    warn: {
      background: "var(--warn)",
      color: "var(--text)",
      border: "1px solid var(--line)",
    },
  };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: "999px",
        padding: "7px 10px",
        fontSize: "12px",
        fontWeight: 850,
        whiteSpace: "nowrap",
        ...styles[tone],
      }}
    >
      {children}
    </span>
  );
}

type CitaPresentation = {
  row: Row;
  movimientoId: string;
  terapistas: string;
  pendiente: number;
  comprobante: string;
};

function CitaMobileCard({ cita }: { cita: CitaPresentation }) {
  const { row, movimientoId, terapistas, pendiente, comprobante } = cita;
  const comprobanteOk = comprobante.toUpperCase().includes("OK");

  return (
    <article className="citasHoyCard">
      <div className="citasHoyCardHeader">
        <strong className="citasHoyCardHour">{hourLabel(row.hora)}</strong>
        <Badge>{row.estado || "-"}</Badge>
      </div>

      <div className="citasHoyCardIdentity">
        <h3>{row.cliente}</h3>
        <p>{row.servicio}</p>
      </div>

      <div className="citasHoyCardTherapist">
        <span>Terapista</span>
        <strong>{terapistas}</strong>
      </div>

      <div className="citasHoyMoneyGrid">
        <div>
          <span>Total</span>
          <strong>{money(row.total_cobrar)}</strong>
        </div>
        <div>
          <span>Pagado</span>
          <strong>{money(row.total_pagado)}</strong>
        </div>
        <div className={pendiente > 0 ? "citasHoyMoneyPending" : ""}>
          <span>Pendiente</span>
          <strong>{money(row.pendiente)}</strong>
        </div>
      </div>

      <div className="citasHoyCardMeta">
        <div>
          <span>Sede</span>
          <strong>{row.sede}</strong>
        </div>
        <div>
          <span>Comprobante</span>
          <Badge tone={comprobanteOk ? "good" : "warn"}>{comprobante}</Badge>
        </div>
      </div>

      {row.whatsapp && (
        <p className="citasHoyWhatsapp">
          <span>WhatsApp</span>
          <strong>
            <a href={waHref(row.whatsapp)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--green)" }}>
              {row.whatsapp}
            </a>
          </strong>
        </p>
      )}

      <small className="citasHoyMovement">Movimiento: {movimientoId}</small>
    </article>
  );
}

export default async function CitasHoyPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireModuleAccess("citas-hoy");
  const params = await searchParams;

  const config = await supabaseSelect<Row>("config_listas");
  const sedeFallback = ["Miraflores", "San Borja"];
  const sedesRows = list(config.data, "SEDES");
  const sedeValues = sedesRows.length ? sedesRows.map((row) => String(row.valor)) : sedeFallback;

  const today = todayInLima();
  const selectedFecha = isValidDateInput(params?.fecha) ? String(params.fecha) : today;
  const selectedSede = normalizeSede(params?.sede, sedeValues);
  const sedeLabel = selectedSede === "TODAS" ? "todas las sedes" : selectedSede;

  const movimientosQuery = [
    "select=movimiento_id,fecha,hora,sede,cliente,whatsapp,servicio,total_cobrar,total_pagado,pendiente,estado,estado_boleta,tipo_comprobante,estado_comprobante_manual,numero_comprobante_final,source_type,created_at",
    `fecha=eq.${selectedFecha}`,
  ];

  const detallesQuery = [
    "select=movimiento_id,fecha,sede,persona_n,terapista,servicio,duracion,monto_asignado",
    `fecha=eq.${selectedFecha}`,
  ];

  if (selectedSede !== "TODAS") {
    const encodedSede = encodeURIComponent(selectedSede);
    movimientosQuery.push(`sede=eq.${encodedSede}`);
    detallesQuery.push(`sede=eq.${encodedSede}`);
  }

  movimientosQuery.push("order=hora.asc");
  detallesQuery.push("order=persona_n.asc");

  const movimientos = await supabaseSelectWhere<Row>(
    "caja_movimientos",
    movimientosQuery.join("&")
  );

  const detalles = await supabaseSelectWhere<Row>(
    "caja_atencion_detalle",
    detallesQuery.join("&")
  );

  const errors = [config.error, movimientos.error, detalles.error].filter(Boolean);

  const detallePorMovimiento = new Map<string, Row[]>();

  for (const detalle of detalles.data) {
    const movimientoId = String(detalle.movimiento_id ?? "");
    const current = detallePorMovimiento.get(movimientoId) ?? [];
    current.push(detalle);
    detallePorMovimiento.set(movimientoId, current);
  }

  const totalCobrar = movimientos.data.reduce(
    (sum, row) => sum + Number(row.total_cobrar ?? 0),
    0
  );

  const totalPagado = movimientos.data.reduce(
    (sum, row) => sum + Number(row.total_pagado ?? 0),
    0
  );

  const totalPendiente = movimientos.data.reduce(
    (sum, row) => sum + Number(row.pendiente ?? 0),
    0
  );

  const citas: CitaPresentation[] = movimientos.data.map((row) => {
    const movimientoId = String(row.movimiento_id ?? "");
    const detalleRows = detallePorMovimiento.get(movimientoId) ?? [];
    const terapistas = detalleRows.length
      ? detalleRows
          .map((detalle) => detalle.terapista)
          .filter(Boolean)
          .join(" / ")
      : "-";
    const pendiente = Number(row.pendiente ?? 0);
    const comprobante = String(
      row.estado_comprobante_manual ||
        row.estado_boleta ||
        row.tipo_comprobante ||
        "-"
    );

    return {
      row,
      movimientoId,
      terapistas,
      pendiente,
      comprobante,
    };
  });

  return (
    <main className="appShell">
      <CajaSidebar session={session} />

      <section className="page">
        <section className="hero" style={{ minHeight: "150px" }}>
          <div>
            <p className="eyebrow">Operación diaria</p>
            <h1>Citas de hoy</h1>
            <p className="subtitle">
              Atenciones y reservas registradas para {dateLabel(selectedFecha)} en {sedeLabel}.
            </p>
          </div>

          <div className="badge">
            <span>Registros</span>
            <strong>{movimientos.data.length}</strong>
          </div>
        </section>

        <section
          className="panel"
          style={{
            padding: "20px",
            marginBottom: "22px",
          }}
        >
          <div className="panelTitle">
            <div>
              <h2>Filtros</h2>
              <p>Consulta citas por fecha y sede sin salir del módulo.</p>
            </div>
          </div>

          <form
            className="citasHoyFilters"
            method="GET"
            action="/citas-hoy"
            style={{
              display: "grid",
            }}
          >
            <label style={fieldStyle}>
              Fecha
              <input name="fecha" type="date" defaultValue={selectedFecha} style={inputStyle} />
            </label>

            <label style={fieldStyle}>
              Sede
              <select name="sede" defaultValue={selectedSede} style={inputStyle}>
                <option value="TODAS">Todas las sedes</option>
                <Options rows={sedesRows} fallback={sedeFallback} />
              </select>
            </label>

            <div className="citasHoyFilterActions">
              <button
                className="citasHoyFilterButton"
                type="submit"
                style={{
                  border: 0,
                  borderRadius: "16px",
                  padding: "14px 18px",
                  fontWeight: 850,
                  cursor: "pointer",
                  background: "var(--green)",
                  color: "white",
                }}
              >
                Aplicar filtros
              </button>

              <a
                className="citasHoyFilterButton"
                href="/citas-hoy"
                style={{
                  background: "white",
                  color: "var(--green)",
                  border: "1px solid var(--line)",
                  borderRadius: "16px",
                  padding: "14px 18px",
                  fontWeight: 850,
                  textDecoration: "none",
                }}
              >
                Ver hoy
              </a>
            </div>
          </form>
        </section>

        {errors.length > 0 && (
          <div className="alert">
            <strong>Revisar conexión:</strong>
            <ul>
              {errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        <section className="grid secondary">
          <div className="card good">
            <span>Total a cobrar</span>
            <strong>{money(totalCobrar)}</strong>
          </div>

          <div className="card good">
            <span>Total pagado</span>
            <strong>{money(totalPagado)}</strong>
          </div>

          <div className="card warn">
            <span>Pendiente</span>
            <strong>{money(totalPendiente)}</strong>
          </div>

          <div className="card">
            <span>Cantidad</span>
            <strong>{movimientos.data.length}</strong>
          </div>
        </section>

        <section className="panel">
          <div className="panelTitle citasHoyAgendaTitle">
            <div>
              <h2>Agenda operativa</h2>
              <p>
                Aquí veremos lo que caja debe atender, cobrar o revisar durante
                el día.
              </p>
            </div>

            <div className="citasHoyActions">
              <a
                className="citasHoyAction"
                href="/nueva-atencion"
                style={{
                  alignSelf: "flex-start",
                  background: "var(--green)",
                  color: "white",
                  borderRadius: "16px",
                  padding: "13px 16px",
                  fontWeight: 850,
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                Nueva atención
              </a>

              <a
                className="citasHoyAction"
                href="/registrar-salida"
                style={{
                  alignSelf: "flex-start",
                  background: "white",
                  color: "var(--green)",
                  border: "1px solid var(--line)",
                  borderRadius: "16px",
                  padding: "13px 16px",
                  fontWeight: 850,
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                Registrar salida
              </a>
            </div>
          </div>

          {movimientos.data.length === 0 ? (
            <div className="alert" style={{ marginBottom: 0 }}>
              No hay citas o atenciones registradas para la fecha y sede seleccionadas.
            </div>
          ) : (
            <>
              <div className="tableWrap citasHoyDesktopTable">
                <table>
                  <thead>
                    <tr>
                      <th>Hora</th>
                      <th>Cliente</th>
                      <th>WhatsApp</th>
                      <th>Sede</th>
                      <th>Servicio</th>
                      <th>Terapista</th>
                      <th>Total</th>
                      <th>Pagado</th>
                      <th>Pendiente</th>
                      <th>Estado</th>
                      <th>Comprobante</th>
                      <th>Movimiento</th>
                    </tr>
                  </thead>

                  <tbody>
                    {citas.map(
                      ({
                        row,
                        movimientoId,
                        terapistas,
                        pendiente,
                        comprobante,
                      }) => (
                        <tr key={movimientoId}>
                          <td>{hourLabel(row.hora)}</td>
                          <td className="strong">{row.cliente}</td>
                          <td>
                            {row.whatsapp ? (
                              <a href={waHref(row.whatsapp)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--green)" }}>
                                {row.whatsapp}
                              </a>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td>{row.sede}</td>
                          <td>{row.servicio}</td>
                          <td>{terapistas}</td>
                          <td>{money(row.total_cobrar)}</td>
                          <td>{money(row.total_pagado)}</td>
                          <td>
                            <Badge tone={pendiente > 0 ? "warn" : "good"}>
                              {money(row.pendiente)}
                            </Badge>
                          </td>
                          <td>
                            <Badge>{row.estado || "-"}</Badge>
                          </td>
                          <td>
                            <Badge
                              tone={
                                comprobante.toUpperCase().includes("OK")
                                  ? "good"
                                  : "warn"
                              }
                            >
                              {comprobante}
                            </Badge>
                          </td>
                          <td>{movimientoId}</td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>

              <div className="citasHoyMobileList">
                {citas.map((cita) => (
                  <CitaMobileCard key={cita.movimientoId} cita={cita} />
                ))}
              </div>
            </>
          )}
        </section>
      </section>
    </main>
  );
}

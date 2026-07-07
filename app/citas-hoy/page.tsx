import { requireAuth } from "@/lib/auth";
import { supabaseSelectWhere } from "@/lib/supabaseServer";

type Row = Record<string, any>;

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

function Sidebar() {
  return (
    <aside className="sidebar">
      <div>
        <p className="sidebarEyebrow">Vita Lima</p>
        <h2>Caja</h2>
      </div>

      <nav className="nav">
        <a href="/">Dashboard</a>
        <a href="/citas-hoy">Citas de hoy</a>
        <a href="/nueva-atencion">Nueva atención</a>
        <a href="/registrar-salida">Registrar salida</a>
        <a href="/#comprobantes">Comprobantes</a>
        <a href="/#alertas">Alertas</a>
      </nav>

      <div className="nextModules">
        <span>Módulos</span>
        <p>Citas de hoy</p>
        <p>Nueva atención</p>
        <p>Registrar salida</p>
        <p>Cierre de caja</p>
      </div>
    </aside>
  );
}

export default async function CitasHoyPage() {
  await requireAuth();

  const today = todayInLima();

  const movimientos = await supabaseSelectWhere<Row>(
    "caja_movimientos",
    [
      "select=movimiento_id,fecha,hora,sede,cliente,whatsapp,servicio,total_cobrar,total_pagado,pendiente,estado,estado_boleta,tipo_comprobante,estado_comprobante_manual,numero_comprobante_final,source_type,created_at",
      `fecha=eq.${today}`,
      "order=hora.asc",
    ].join("&")
  );

  const detalles = await supabaseSelectWhere<Row>(
    "caja_atencion_detalle",
    [
      "select=movimiento_id,persona_n,terapista,servicio,duracion,monto_asignado",
      `fecha=eq.${today}`,
      "order=persona_n.asc",
    ].join("&")
  );

  const errors = [movimientos.error, detalles.error].filter(Boolean);

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

  return (
    <main className="appShell">
      <Sidebar />

      <section className="page">
        <section className="hero" style={{ minHeight: "150px" }}>
          <div>
            <p className="eyebrow">Operación diaria</p>
            <h1>Citas de hoy</h1>
            <p className="subtitle">
              Atenciones y reservas registradas para {dateLabel(today)}.
            </p>
          </div>

          <div className="badge">
            <span>Registros</span>
            <strong>{movimientos.data.length}</strong>
          </div>
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
          <div className="panelTitle">
            <div>
              <h2>Agenda operativa</h2>
              <p>
                Aquí veremos lo que caja debe atender, cobrar o revisar durante
                el día.
              </p>
            </div>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <a
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
              No hay citas o atenciones registradas para hoy.
            </div>
          ) : (
            <div className="tableWrap">
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
                  {movimientos.data.map((row) => {
                    const movimientoId = String(row.movimiento_id ?? "");
                    const detalleRows =
                      detallePorMovimiento.get(movimientoId) ?? [];

                    const terapistas = detalleRows.length
                      ? detalleRows
                          .map((detalle) => detalle.terapista)
                          .filter(Boolean)
                          .join(" / ")
                      : "-";

                    const pendiente = Number(row.pendiente ?? 0);
                    const comprobante =
                      row.estado_comprobante_manual ||
                      row.estado_boleta ||
                      row.tipo_comprobante ||
                      "-";

                    return (
                      <tr key={movimientoId}>
                        <td>{hourLabel(row.hora)}</td>
                        <td className="strong">{row.cliente}</td>
                        <td>{row.whatsapp || "-"}</td>
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
                              String(comprobante).toUpperCase().includes("OK")
                                ? "good"
                                : "warn"
                            }
                          >
                            {comprobante}
                          </Badge>
                        </td>
                        <td>{movimientoId}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

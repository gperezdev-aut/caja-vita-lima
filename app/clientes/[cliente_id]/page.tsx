import type { CSSProperties, ReactNode } from "react";
import { notFound } from "next/navigation";
import { requireModuleAccess } from "@/lib/auth";
import { CajaSidebar } from "@/components/CajaSidebar";
import { supabaseSelectWhere } from "@/lib/supabaseServer";

type Row = Record<string, any>;

type PageParams = Promise<{
  cliente_id: string;
}>;

function money(value: any) {
  const numberValue = Number(value ?? 0);

  return `S/ ${numberValue.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function numberFmt(value: any) {
  return Number(value ?? 0).toLocaleString("es-PE");
}

function safe(value: any) {
  const text = String(value ?? "").trim();
  return text || "-";
}

function short(value: any, max = 80) {
  const text = safe(value);
  if (text === "-") return text;
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function dateShort(value: any) {
  if (!value) return "-";

  const date = new Date(`${value}T00:00:00`);

  return date.toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function timeShort(value: any) {
  if (!value) return "-";
  return String(value).slice(0, 5);
}

function norm(value: any) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

function getEstado(row: Row) {
  return safe(row.estado_cliente_crm ?? row.nivel_cliente_crm ?? row.segmento_cliente);
}

function getActividad(row: Row) {
  const explicit = String(row.estado_actividad_crm ?? "").trim();
  if (explicit) return explicit;

  const dias = Number(row.dias_sin_visita ?? 0);
  if (!row.ultima_visita && !row.ultima_reserva) return "Sin fecha";
  if (dias > 60) return "Inactivo";
  return "Activo";
}

function getContacto(row: Row) {
  const explicit = String(row.calidad_contacto_crm ?? "").trim();
  if (explicit) return explicit;

  if (String(row.whatsapp ?? "").trim()) return "Con WhatsApp";
  if (String(row.dni ?? "").trim() || String(row.email ?? "").trim()) {
    return "Con dato parcial";
  }

  return "Sin contacto";
}

function badgeTone(value: any): "default" | "good" | "warn" | "danger" {
  const text = norm(value);

  if (text.includes("vip") || text.includes("activo") || text.includes("emitida")) {
    return "good";
  }

  if (text.includes("inactivo") || text.includes("pendiente") || text.includes("sin contacto")) {
    return "danger";
  }

  if (text.includes("recurrente") || text.includes("historico") || text.includes("histórico")) {
    return "warn";
  }

  return "default";
}

function Card({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "warn";
}) {
  return (
    <div className={`card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "good" | "warn" | "danger";
}) {
  const styles: Record<string, CSSProperties> = {
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
    danger: {
      background: "var(--danger)",
      color: "var(--danger-text)",
      border: "1px solid rgba(163, 50, 37, 0.18)",
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

function InfoItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid var(--line)",
        borderRadius: "18px",
        padding: "15px 16px",
        minWidth: 0,
      }}
    >
      <span
        style={{
          display: "block",
          color: "var(--muted)",
          fontSize: "12px",
          fontWeight: 850,
          marginBottom: "8px",
        }}
      >
        {label}
      </span>
      <strong
        style={{
          display: "block",
          color: "var(--text)",
          fontSize: "16px",
          lineHeight: 1.35,
          wordBreak: "break-word",
        }}
      >
        {value}
      </strong>
    </div>
  );
}

function groupByService(rows: Row[]) {
  const map = new Map<string, Row>();

  for (const row of rows) {
    const name = safe(row.catalogo_nombre ?? row.servicio_original);
    const key = name;

    const current = map.get(key) ?? {
      servicio: name,
      visitas: 0,
      pax: 0,
      total_pagado: 0,
      total_cobrar: 0,
      ultima_fecha: row.fecha,
      tipo: row.catalogo_tipo,
      grupo: row.catalogo_menu_group,
    };

    current.visitas += 1;
    current.pax += Number(row.n_pax ?? 0);
    current.total_pagado += Number(row.total_pagado ?? 0);
    current.total_cobrar += Number(row.total_cobrar ?? 0);

    if (String(row.fecha ?? "") > String(current.ultima_fecha ?? "")) {
      current.ultima_fecha = row.fecha;
    }

    map.set(key, current);
  }

  return Array.from(map.values()).sort(
    (a, b) => Number(b.total_pagado ?? 0) - Number(a.total_pagado ?? 0)
  );
}

export default async function ClienteDetallePage({
  params,
}: {
  params: PageParams;
}) {
  const session = await requireModuleAccess("clientes");
  const { cliente_id } = await params;
  const clienteId = decodeURIComponent(cliente_id);

  const clienteResult = await supabaseSelectWhere<Row>(
    "vista_clientes_crm_catalogo",
    [
      "select=*",
      `cliente_id=eq.${encodeURIComponent(clienteId)}`,
      "limit=1",
    ].join("&")
  );

  const historialResult = await supabaseSelectWhere<Row>(
    "vista_cliente_historial_crm",
    [
      "select=*",
      `cliente_id=eq.${encodeURIComponent(clienteId)}`,
      "order=fecha.desc,hora.desc",
      "limit=300",
    ].join("&")
  );

  const cliente = clienteResult.data?.[0];

  if (!cliente && !clienteResult.error) {
    notFound();
  }

  const historial = historialResult.data ?? [];
  const errors = [clienteResult.error, historialResult.error].filter(Boolean);

  const totalCobrarHistorial = historial.reduce(
    (sum, row) => sum + Number(row.total_cobrar ?? 0),
    0
  );

  const totalPagadoHistorial = historial.reduce(
    (sum, row) => sum + Number(row.total_pagado ?? 0),
    0
  );

  const totalPendienteHistorial = historial.reduce(
    (sum, row) => sum + Number(row.pendiente ?? 0),
    0
  );

  const totalPaxHistorial = historial.reduce(
    (sum, row) => sum + Number(row.n_pax ?? 0),
    0
  );

  const boletasPendientes = historial.filter((row) => {
    const estadoBoleta = norm(row.estado_boleta);
    const estadoManual = norm(row.estado_comprobante_manual);
    const numero = String(row.numero_boleta ?? row.numero_comprobante_final ?? "").trim();

    return (
      !numero ||
      estadoBoleta.includes("pendiente") ||
      estadoBoleta.includes("por_definir") ||
      estadoManual.includes("pendiente") ||
      estadoManual.includes("observar")
    );
  }).length;

  const serviciosAgrupados = groupByService(historial);
  const ultimoMovimiento = historial[0] ?? {};
  const servicioFavorito = serviciosAgrupados[0] ?? {};

  const whatsapp = safe(cliente?.whatsapp);
  const dni = safe(cliente?.dni);
  const email = safe(cliente?.email);

  return (
    <main className="appShell" style={{ overflowX: "hidden" }}>
      <CajaSidebar session={session} />

      <section className="page clienteDetallePage">
        <section className="hero" style={{ minHeight: "150px" }}>
          <div>
            <p className="eyebrow">Ficha CRM</p>
            <h1>{safe(cliente?.cliente)}</h1>
            <p className="subtitle">
              Historial comercial, servicios comprados, gasto acumulado y alertas del cliente.
            </p>
          </div>

          <div className="badge">
            <span>Estado</span>
            <strong>{getEstado(cliente ?? {})}</strong>
          </div>
        </section>

        <div style={{ marginBottom: "20px" }}>
          <a
            href="/clientes"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid var(--line)",
              borderRadius: "15px",
              background: "white",
              color: "var(--green)",
              fontWeight: 900,
              textDecoration: "none",
              padding: "12px 16px",
            }}
          >
            ← Volver a Clientes
          </a>
        </div>

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
          <Card
            label="Total gastado"
            value={money(cliente?.total_gastado ?? totalPagadoHistorial)}
            tone="good"
          />
          <Card
            label="Visitas"
            value={numberFmt(cliente?.total_visitas ?? historial.length)}
            tone="good"
          />
          <Card
            label="Ticket promedio"
            value={money(cliente?.ticket_promedio)}
          />
          <Card
            label="Días sin visita"
            value={numberFmt(cliente?.dias_sin_visita)}
            tone="warn"
          />
        </section>

        <section className="grid secondary">
          <Card label="Total cobrado historial" value={money(totalPagadoHistorial)} />
          <Card label="Total por cobrar" value={money(totalCobrarHistorial)} />
          <Card label="Pendiente historial" value={money(totalPendienteHistorial)} tone="warn" />
          <Card label="Pax acumulado" value={numberFmt(cliente?.total_pax ?? totalPaxHistorial)} />
        </section>

        <section className="panel">
          <div className="panelTitle">
            <div>
              <h2>Datos del cliente</h2>
              <p>Información principal para contacto, segmentación y seguimiento.</p>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
              gap: "14px",
            }}
          >
            <InfoItem label="Cliente ID" value={safe(cliente?.cliente_id)} />
            <InfoItem label="WhatsApp" value={whatsapp} />
            <InfoItem label="DNI" value={dni} />
            <InfoItem label="Email" value={email} />
            <InfoItem label="Primera visita" value={dateShort(cliente?.primera_visita)} />
            <InfoItem label="Última visita" value={dateShort(cliente?.ultima_visita)} />
            <InfoItem label="Sede frecuente" value={safe(cliente?.sede_frecuente ?? cliente?.ultima_sede)} />
            <InfoItem label="Contacto CRM" value={getContacto(cliente ?? {})} />
            <InfoItem
              label="Estado CRM"
              value={<Badge tone={badgeTone(getEstado(cliente ?? {}))}>{getEstado(cliente ?? {})}</Badge>}
            />
            <InfoItem
              label="Actividad"
              value={
                <Badge tone={badgeTone(getActividad(cliente ?? {}))}>
                  {getActividad(cliente ?? {})}
                </Badge>
              }
            />
            <InfoItem label="Segmento" value={safe(cliente?.segmento_cliente)} />
            <InfoItem label="Origen" value={safe(cliente?.origen)} />
          </div>
        </section>

        <section className="twoCols">
          <div className="panel">
            <div className="panelTitle">
              <div>
                <h2>Servicio favorito</h2>
                <p>Detectado desde el historial del cliente.</p>
              </div>
            </div>

            <div className="miniList">
              <div className="miniItem">
                <span>Servicio catálogo</span>
                <strong>{short(cliente?.servicio_mas_comprado_catalogo_nombre, 42)}</strong>
              </div>
              <div className="miniItem">
                <span>Servicio histórico</span>
                <strong>{short(cliente?.servicio_mas_comprado, 42)}</strong>
              </div>
              <div className="miniItem">
                <span>Tipo catálogo</span>
                <strong>{safe(cliente?.servicio_mas_comprado_catalogo_tipo)}</strong>
              </div>
              <div className="miniItem">
                <span>Grupo comercial</span>
                <strong>{safe(cliente?.servicio_mas_comprado_menu_group)}</strong>
              </div>
              <div className="miniItem">
                <span>Más comprado en ficha</span>
                <strong>{short(servicioFavorito.servicio, 42)}</strong>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panelTitle">
              <div>
                <h2>Alertas rápidas</h2>
                <p>Puntos útiles para caja, socios y recuperación.</p>
              </div>
            </div>

            <div className="miniList">
              <div className="miniItem">
                <span>Boletas / comprobantes por revisar</span>
                <strong>{numberFmt(boletasPendientes)}</strong>
              </div>
              <div className="miniItem">
                <span>Último movimiento</span>
                <strong>
                  {dateShort(ultimoMovimiento.fecha)} {timeShort(ultimoMovimiento.hora)}
                </strong>
              </div>
              <div className="miniItem">
                <span>Último servicio</span>
                <strong>{short(ultimoMovimiento.catalogo_nombre ?? ultimoMovimiento.servicio_original, 42)}</strong>
              </div>
              <div className="miniItem">
                <span>Última sede</span>
                <strong>{safe(ultimoMovimiento.sede ?? cliente?.ultima_sede)}</strong>
              </div>
              <div className="miniItem">
                <span>Nota / alerta atención</span>
                <strong>{short(cliente?.alerta_atencion ?? cliente?.notas, 42)}</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panelTitle">
            <div>
              <h2>Servicios comprados</h2>
              <p>Agrupado por servicio catálogo o histórico.</p>
            </div>
          </div>

          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Servicio</th>
                  <th>Tipo</th>
                  <th>Grupo</th>
                  <th>Visitas</th>
                  <th>Pax</th>
                  <th>Total pagado</th>
                  <th>Total cobrar</th>
                  <th>Última venta</th>
                </tr>
              </thead>
              <tbody>
                {serviciosAgrupados.length === 0 && (
                  <tr>
                    <td colSpan={8}>No hay servicios agrupados para este cliente.</td>
                  </tr>
                )}

                {serviciosAgrupados.map((row, index) => (
                  <tr key={`${row.servicio}-${index}`}>
                    <td className="strong">{short(row.servicio, 80)}</td>
                    <td>
                      <Badge tone={badgeTone(row.tipo)}>{safe(row.tipo)}</Badge>
                    </td>
                    <td>{safe(row.grupo)}</td>
                    <td>{numberFmt(row.visitas)}</td>
                    <td>{numberFmt(row.pax)}</td>
                    <td className="strong">{money(row.total_pagado)}</td>
                    <td>{money(row.total_cobrar)}</td>
                    <td>{dateShort(row.ultima_fecha)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panelTitle">
            <div>
              <h2>Historial de atenciones</h2>
              <p>Movimientos registrados en caja para este cliente.</p>
            </div>
          </div>

          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Hora</th>
                  <th>Sede</th>
                  <th>Servicio original</th>
                  <th>Servicio catálogo</th>
                  <th>Pax</th>
                  <th>Total cobrar</th>
                  <th>Total pagado</th>
                  <th>Pendiente</th>
                  <th>Boleta</th>
                  <th>Comprobante</th>
                  <th>Responsable</th>
                  <th>Observación</th>
                </tr>
              </thead>
              <tbody>
                {historial.length === 0 && (
                  <tr>
                    <td colSpan={13}>No hay historial para este cliente.</td>
                  </tr>
                )}

                {historial.map((row, index) => (
                  <tr key={`${row.movimiento_id ?? index}`}>
                    <td>{dateShort(row.fecha)}</td>
                    <td>{timeShort(row.hora)}</td>
                    <td>{safe(row.sede)}</td>
                    <td>{short(row.servicio_original, 60)}</td>
                    <td className="strong">{short(row.catalogo_nombre, 60)}</td>
                    <td>{numberFmt(row.n_pax)}</td>
                    <td>{money(row.total_cobrar)}</td>
                    <td className="strong">{money(row.total_pagado)}</td>
                    <td>{money(row.pendiente)}</td>
                    <td>
                      <Badge tone={badgeTone(row.estado_boleta)}>
                        {safe(row.estado_boleta)}
                      </Badge>
                    </td>
                    <td>{safe(row.numero_comprobante_final ?? row.numero_boleta)}</td>
                    <td>{safe(row.responsable)}</td>
                    <td>{short(row.observacion, 60)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      <style>
        {`
          .clienteDetallePage {
            transform: translateX(-155px);
          }

          @media (max-width: 1280px) {
            .clienteDetallePage {
              transform: none;
            }
          }
        `}
      </style>
    </main>
  );
}

import { requireModuleAccess } from "@/lib/auth";
import { CajaSidebar } from "@/components/CajaSidebar";
import { supabaseSelectWhere } from "@/lib/supabaseServer";
import { updateComprobanteAction } from "./actions";

type Row = Record<string, any>;

type SearchParams = Promise<{
  ok?: string;
  id?: string;
  error?: string;
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

function dateLabel(value: any) {
  if (!value) return "-";

  const date = new Date(`${value}T00:00:00`);

  return date.toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "2-digit",
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

function isPendingComprobante(row: Row) {
  const estadoManual = String(row.estado_comprobante_manual ?? "").toUpperCase();
  const tipo = String(row.tipo_comprobante ?? "").toUpperCase();
  const estadoBoleta = String(row.estado_boleta ?? "").toUpperCase();

  return (
    estadoManual.includes("PENDIENTE") ||
    estadoManual.includes("OBSERVAR") ||
    tipo.includes("POR_DEFINIR") ||
    (!estadoManual && estadoBoleta.includes("PEND"))
  );
}

function Badge({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "good" | "warn" | "danger";
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

function FormGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
        gap: "12px",
      }}
    >
      {children}
    </div>
  );
}

function ComprobanteCard({ row }: { row: Row }) {
  const movimientoId = String(row.movimiento_id ?? "");
  const estadoActual = String(row.estado_comprobante_manual ?? "PENDIENTE");
  const tipoActual = String(row.tipo_comprobante ?? "POR_DEFINIR");

  const tone = estadoActual.toUpperCase().includes("OBSERVAR")
    ? "danger"
    : "warn";

  return (
    <article
      style={{
        border: "1px solid var(--line)",
        borderRadius: "22px",
        background: "white",
        padding: "18px",
        display: "grid",
        gap: "16px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "14px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h3 style={{ margin: "0 0 8px", fontSize: "20px" }}>
            {row.cliente || "Cliente sin nombre"}
          </h3>
          <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
            {dateLabel(row.fecha)} · {hourLabel(row.hora)} · {row.sede || "-"} ·{" "}
            {row.servicio || "-"}
          </p>
          <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.5 }}>
            WhatsApp:{" "}
            {row.whatsapp ? (
              <a href={waHref(row.whatsapp)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--green)" }}>
                {row.whatsapp}
              </a>
            ) : (
              "-"
            )}{" "}
            · Movimiento: {movimientoId}
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "flex-start", flexWrap: "wrap" }}>
          <Badge tone={tone}>{estadoActual || "PENDIENTE"}</Badge>
          <Badge>{tipoActual || "POR_DEFINIR"}</Badge>
          <Badge tone="good">{money(row.total_cobrar)}</Badge>
        </div>
      </div>

      <form action={updateComprobanteAction} style={{ display: "grid", gap: "14px" }}>
        <input type="hidden" name="movimiento_id" value={movimientoId} />

        <FormGrid>
          <label style={fieldStyle}>
            Tipo comprobante
            <select name="tipo_comprobante" defaultValue={tipoActual} style={inputStyle}>
              <option value="POR_DEFINIR">Por definir</option>
              <option value="BOLETA">Boleta</option>
              <option value="FACTURA">Factura</option>
              <option value="NO_APLICA">No aplica</option>
            </select>
          </label>

          <label style={fieldStyle}>
            Estado
            <select
              name="estado_comprobante_manual"
              defaultValue={estadoActual}
              style={inputStyle}
            >
              <option value="PENDIENTE">Pendiente</option>
              <option value="OBSERVAR">Observar</option>
              <option value="OK">OK</option>
              <option value="NO_APLICA">No aplica</option>
            </select>
          </label>

          <label style={fieldStyle}>
            Número final
            <input
              name="numero_comprobante_final"
              defaultValue={row.numero_comprobante_final ?? row.numero_boleta ?? ""}
              placeholder="Ej. B001-000123"
              style={inputStyle}
            />
          </label>

          <label style={fieldStyle}>
            Fecha emisión
            <input
              name="fecha_emision_comprobante"
              type="date"
              defaultValue={row.fecha_emision_comprobante ?? ""}
              style={inputStyle}
            />
          </label>

          <label style={fieldStyle}>
            Revisado por
            <input
              name="comprobante_revisado_por"
              defaultValue={row.comprobante_revisado_por ?? "Gerald"}
              style={inputStyle}
            />
          </label>
        </FormGrid>

        <label style={fieldStyle}>
          Observación comprobante
          <textarea
            name="observacion_comprobante"
            rows={3}
            defaultValue={row.observacion_comprobante ?? ""}
            placeholder="Ej. Falta número, boleta emitida, factura solicitada, no aplica, etc."
            style={{ ...inputStyle, resize: "vertical", minHeight: "90px" }}
          />
        </label>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="submit"
            style={{
              border: 0,
              borderRadius: "16px",
              padding: "13px 18px",
              fontWeight: 850,
              cursor: "pointer",
              background: "var(--green)",
              color: "white",
            }}
          >
            Guardar comprobante
          </button>
        </div>
      </form>
    </article>
  );
}

export default async function ComprobantesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireModuleAccess("comprobantes");

  const params = await searchParams;

  const movimientos = await supabaseSelectWhere<Row>(
    "caja_movimientos",
    [
      "select=movimiento_id,fecha,hora,sede,cliente,whatsapp,servicio,total_cobrar,total_pagado,pendiente,estado_boleta,numero_boleta,tipo_comprobante,estado_comprobante_manual,numero_comprobante_final,fecha_emision_comprobante,observacion_comprobante,comprobante_revisado_por,comprobante_revisado_at,created_at",
      "order=created_at.desc",
      "limit=500",
    ].join("&")
  );

  const pendientes = movimientos.data.filter(isPendingComprobante);
  const observar = pendientes.filter((row) =>
    String(row.estado_comprobante_manual ?? "").toUpperCase().includes("OBSERVAR")
  );
  const porDefinir = pendientes.filter((row) =>
    String(row.tipo_comprobante ?? "").toUpperCase().includes("POR_DEFINIR")
  );
  const montoPendiente = pendientes.reduce(
    (sum, row) => sum + Number(row.total_cobrar ?? 0),
    0
  );

  return (
    <main className="appShell">
      <CajaSidebar session={session} />

      <section className="page">
        <section className="hero" style={{ minHeight: "150px" }}>
          <div>
            <p className="eyebrow">Control interno</p>
            <h1>Comprobantes</h1>
            <p className="subtitle">
              Revisa boletas, facturas y comprobantes pendientes de la caja.
            </p>
          </div>

          <div className="badge">
            <span>Pendientes</span>
            <strong>{pendientes.length}</strong>
          </div>
        </section>

        {params?.ok && (
          <div
            role="alert"
            style={{
              borderRadius: "18px",
              padding: "16px 18px",
              marginBottom: "18px",
              background: "var(--green-soft)",
              color: "var(--green)",
              border: "1px solid rgba(31, 107, 79, 0.18)",
              fontWeight: 800,
            }}
          >
            Comprobante actualizado correctamente. Movimiento: <strong>{params.id}</strong>
          </div>
        )}

        {params?.error && (
          <div
            role="alert"
            style={{
              borderRadius: "18px",
              padding: "16px 18px",
              marginBottom: "18px",
              background: "var(--danger)",
              color: "var(--danger-text)",
              border: "1px solid rgba(163, 50, 37, 0.18)",
              fontWeight: 800,
            }}
          >
            <strong>No se pudo guardar:</strong> {params.error}
          </div>
        )}

        {movimientos.error && (
          <div className="alert">
            <strong>Revisar conexión:</strong> {movimientos.error}
          </div>
        )}

        <section className="grid secondary">
          <div className="card warn">
            <span>Pendientes / observar</span>
            <strong>{pendientes.length}</strong>
          </div>

          <div className="card warn">
            <span>Por definir</span>
            <strong>{porDefinir.length}</strong>
          </div>

          <div className="card">
            <span>Observar</span>
            <strong>{observar.length}</strong>
          </div>

          <div className="card good">
            <span>Monto por revisar</span>
            <strong>{money(montoPendiente)}</strong>
          </div>
        </section>

        <section className="panel">
          <div className="panelTitle">
            <div>
              <h2>Lista editable</h2>
              <p>
                Actualiza el tipo, estado, número y fecha de emisión del comprobante.
              </p>
            </div>
          </div>

          {pendientes.length === 0 ? (
            <div className="alert" style={{ marginBottom: 0 }}>
              No hay comprobantes pendientes u observados para revisar.
            </div>
          ) : (
            <div style={{ display: "grid", gap: "14px" }}>
              {pendientes.map((row) => (
                <ComprobanteCard key={row.movimiento_id} row={row} />
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

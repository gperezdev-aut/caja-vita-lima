import { requireModuleAccess } from "@/lib/auth";
import { CajaSidebar } from "@/components/CajaSidebar";
import { supabaseSelectWhere } from "@/lib/supabaseServer";
import { createCierreCajaAction } from "./actions";

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

function numberFmt(value: any) {
  return Number(value ?? 0).toLocaleString("es-PE");
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

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        border: "1px solid var(--line)",
        borderRadius: "22px",
        background: "white",
        padding: "20px",
      }}
    >
      <h2 style={{ margin: "0 0 16px", fontSize: "22px" }}>{title}</h2>
      {children}
    </section>
  );
}

function FormGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
        gap: "14px",
      }}
    >
      {children}
    </div>
  );
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

export default async function CierreCajaPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireModuleAccess("cierre-caja");

  const params = await searchParams;
  const today = todayInLima();
  const defaultSede = "Miraflores";

  const movimientos = await supabaseSelectWhere<Row>(
    "caja_movimientos",
    [
      "select=movimiento_id,fecha,sede,n_pax,total_pagado,estado_comprobante_manual,tipo_comprobante,estado_boleta",
      `fecha=eq.${today}`,
      `sede=eq.${encodeURIComponent(defaultSede)}`,
    ].join("&")
  );

  const salidas = await supabaseSelectWhere<Row>(
    "caja_salidas",
    [
      "select=salida_id,fecha,sede,monto",
      `fecha=eq.${today}`,
      `sede=eq.${encodeURIComponent(defaultSede)}`,
    ].join("&")
  );

  const cierres = await supabaseSelectWhere<Row>(
    "caja_cierres",
    [
      "select=cierre_id,fecha,sede,total_ingresos,total_salidas,caja_esperada,diferencia,responsable,created_at",
      `fecha=eq.${today}`,
      "order=created_at.desc",
    ].join("&")
  );

  const errors = [movimientos.error, salidas.error, cierres.error].filter(Boolean);

  const totalIngresos = movimientos.data.reduce(
    (sum, row) => sum + Number(row.total_pagado ?? 0),
    0
  );

  const totalSalidas = salidas.data.reduce(
    (sum, row) => sum + Number(row.monto ?? 0),
    0
  );

  const paxTotal = movimientos.data.reduce(
    (sum, row) => sum + Number(row.n_pax ?? 0),
    0
  );

  const boletasPendientes = movimientos.data.filter((row) => {
    const estado = String(
      row.estado_comprobante_manual || row.estado_boleta || row.tipo_comprobante || ""
    ).toUpperCase();

    return (
      estado.includes("PEND") ||
      estado.includes("OBSERV") ||
      estado.includes("POR_DEFINIR")
    );
  }).length;

  return (
    <main className="appShell">
      <CajaSidebar session={session} />

      <section className="page">
        <section className="hero" style={{ minHeight: "150px" }}>
          <div>
            <p className="eyebrow">Control diario</p>
            <h1>Cierre de caja</h1>
            <p className="subtitle">
              Registra el cierre diario por sede. Los valores sugeridos se
              calculan con movimientos y salidas de hoy en Miraflores.
            </p>
          </div>

          <div className="badge">
            <span>Cierres hoy</span>
            <strong>{cierres.data.length}</strong>
          </div>
        </section>

        {params?.ok && (
          <div
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
            Cierre guardado correctamente. ID: <strong>{params.id}</strong>
          </div>
        )}

        {params?.error && (
          <div
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
          <Card label="Ingresos hoy" value={money(totalIngresos)} tone="good" />
          <Card label="Salidas hoy" value={money(totalSalidas)} />
          <Card label="Pax hoy" value={numberFmt(paxTotal)} />
          <Card label="Boletas pendientes" value={numberFmt(boletasPendientes)} tone="warn" />
        </section>

        <form
          action={createCierreCajaAction}
          style={{
            background: "rgba(255, 250, 241, 0.9)",
            border: "1px solid var(--line)",
            borderRadius: "26px",
            boxShadow: "var(--shadow)",
            padding: "24px",
            display: "grid",
            gap: "22px",
            marginBottom: "24px",
          }}
        >
          <Section title="Datos del cierre">
            <FormGrid>
              <label style={fieldStyle}>
                Fecha
                <input name="fecha" type="date" defaultValue={today} required style={inputStyle} />
              </label>

              <label style={fieldStyle}>
                Sede
                <select name="sede" defaultValue={defaultSede} required style={inputStyle}>
                  <option value="Miraflores">Miraflores</option>
                  <option value="San Borja">San Borja</option>
                </select>
              </label>

              <label style={fieldStyle}>
                Responsable
                <select name="responsable" defaultValue="Gerald" style={inputStyle}>
                  <option value="Gerald">Gerald</option>
                  <option value="Luis">Luis</option>
                  <option value="Naty">Naty</option>
                  <option value="Otro">Otro</option>
                </select>
              </label>

              <label style={fieldStyle}>
                Estado
                <input value="CERRADO" readOnly style={inputStyle} />
              </label>
            </FormGrid>
          </Section>

          <Section title="Montos">
            <FormGrid>
              <label style={fieldStyle}>
                Caja inicial
                <input name="caja_inicial" type="number" step="0.01" min="0" defaultValue="0.00" required style={inputStyle} />
              </label>

              <label style={fieldStyle}>
                Efectivo contado
                <input name="efectivo_contado" type="number" step="0.01" min="0" defaultValue="0.00" required style={inputStyle} />
              </label>

              <label style={fieldStyle}>
                Pozo / fondo
                <input name="pozo_fondo" type="number" step="0.01" min="0" defaultValue="0.00" required style={inputStyle} />
              </label>

              <label style={fieldStyle}>
                Total ingresos
                <input name="total_ingresos" type="number" step="0.01" min="0" defaultValue={totalIngresos.toFixed(2)} required style={inputStyle} />
              </label>

              <label style={fieldStyle}>
                Total salidas
                <input name="total_salidas" type="number" step="0.01" min="0" defaultValue={totalSalidas.toFixed(2)} required style={inputStyle} />
              </label>

              <label style={fieldStyle}>
                Pax total
                <input name="pax_total" type="number" min="0" defaultValue={String(paxTotal)} required style={inputStyle} />
              </label>

              <label style={fieldStyle}>
                Boletas pendientes
                <input name="boletas_pendientes" type="number" min="0" defaultValue={String(boletasPendientes)} required style={inputStyle} />
              </label>
            </FormGrid>
          </Section>

          <Section title="Observación">
            <label style={fieldStyle}>
              Nota interna
              <textarea
                name="observacion"
                placeholder="Ej. Cierre de prueba, faltó efectivo, boleta pendiente, diferencia explicada, etc."
                rows={4}
                style={{
                  ...inputStyle,
                  resize: "vertical",
                  minHeight: "110px",
                }}
              />
            </label>
          </Section>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", flexWrap: "wrap" }}>
            <a
              href="/"
              style={{
                background: "white",
                color: "var(--green)",
                border: "1px solid var(--line)",
                borderRadius: "16px",
                padding: "15px 18px",
                fontWeight: 850,
                textDecoration: "none",
              }}
            >
              Volver al dashboard
            </a>

            <button
              type="submit"
              style={{
                border: 0,
                borderRadius: "16px",
                padding: "15px 18px",
                fontWeight: 850,
                cursor: "pointer",
                background: "var(--green)",
                color: "white",
              }}
            >
              Guardar cierre
            </button>
          </div>
        </form>

        <section className="panel">
          <div className="panelTitle">
            <div>
              <h2>Cierres registrados hoy</h2>
              <p>Últimos cierres guardados para control interno.</p>
            </div>
          </div>

          {cierres.data.length === 0 ? (
            <div className="alert" style={{ marginBottom: 0 }}>
              Todavía no hay cierres registrados hoy.
            </div>
          ) : (
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Sede</th>
                    <th>Ingresos</th>
                    <th>Salidas</th>
                    <th>Caja esperada</th>
                    <th>Diferencia</th>
                    <th>Responsable</th>
                    <th>Cierre</th>
                  </tr>
                </thead>
                <tbody>
                  {cierres.data.map((row) => (
                    <tr key={row.cierre_id}>
                      <td>{row.fecha}</td>
                      <td>{row.sede}</td>
                      <td>{money(row.total_ingresos)}</td>
                      <td>{money(row.total_salidas)}</td>
                      <td>{money(row.caja_esperada)}</td>
                      <td className="strong">{money(row.diferencia)}</td>
                      <td>{row.responsable || "-"}</td>
                      <td>{row.cierre_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

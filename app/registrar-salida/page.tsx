import { requireModuleAccess } from "@/lib/auth";
import { CajaSidebar } from "@/components/CajaSidebar";
import { supabaseSelect, supabaseSelectWhere } from "@/lib/supabaseServer";
import { SubmitButton } from "@/components/SubmitButton";
import { createSalidaAction } from "./actions";

type Row = Record<string, any>;

type SearchParams = Promise<{
  ok?: string;
  id?: string;
  error?: string;
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

function nowInLima() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Lima",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";

  return `${h}:${m}`;
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

function safeDate(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  return value;
}

function safeSede(value: string | undefined) {
  if (!value) return "TODAS";
  return value;
}

export default async function RegistrarSalidaPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireModuleAccess("registrar-salida");

  const params = await searchParams;
  const today = todayInLima();
  const selectedFecha = safeDate(params?.fecha, today);
  const selectedSede = safeSede(params?.sede);

  const config = await supabaseSelect<Row>("config_listas");

  const queryParts = [
    "select=salida_id,fecha,hora,sede,tipo_gasto,concepto,monto,responsable,observacion,created_at",
    `fecha=eq.${selectedFecha}`,
    "order=created_at.desc",
  ];

  if (selectedSede !== "TODAS") {
    queryParts.splice(2, 0, `sede=eq.${encodeURIComponent(selectedSede)}`);
  }

  const salidas = await supabaseSelectWhere<Row>(
    "caja_salidas",
    queryParts.join("&")
  );

  const sedes = list(config.data, "SEDES");
  const responsables = list(config.data, "RESPONSABLES");
  const tiposGasto = list(config.data, "TIPOS_GASTO");

  const totalSalidas = salidas.data.reduce(
    (sum, row) => sum + Number(row.monto ?? 0),
    0
  );

  const errors = [config.error, salidas.error].filter(Boolean);
  const sedeLabel = selectedSede === "TODAS" ? "todas las sedes" : selectedSede;

  return (
    <main className="appShell">
      <CajaSidebar session={session} />

      <section className="page">
        <section className="hero" style={{ minHeight: "150px" }}>
          <div>
            <p className="eyebrow">Operación</p>
            <h1>Registrar salida</h1>
            <p className="subtitle">
              Registra gastos, compras, pagos operativos o salidas de caja.
              La lista inferior muestra salidas de {dateLabel(selectedFecha)} en {sedeLabel}.
            </p>
          </div>

          <div className="badge">
            <span>Salidas</span>
            <strong>{money(totalSalidas)}</strong>
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
            Salida guardada correctamente. ID: <strong>{params.id}</strong>
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

        <section className="panel" style={{ marginBottom: "24px" }}>
          <div className="panelTitle">
            <div>
              <h2>Filtros</h2>
              <p>Consulta salidas por fecha y sede sin salir del módulo.</p>
            </div>
          </div>

          <form method="get" action="/registrar-salida">
            <FormGrid>
              <label style={fieldStyle}>
                Fecha
                <input
                  name="fecha"
                  type="date"
                  defaultValue={selectedFecha}
                  required
                  style={inputStyle}
                />
              </label>

              <label style={fieldStyle}>
                Sede
                <select name="sede" defaultValue={selectedSede} style={inputStyle}>
                  <option value="TODAS">Todas las sedes</option>
                  <Options rows={sedes} fallback={["Miraflores", "San Borja"]} />
                </select>
              </label>

              <div style={{ display: "flex", alignItems: "end", gap: "10px", flexWrap: "wrap" }}>
                <button
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
                  href="/registrar-salida"
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
            </FormGrid>
          </form>
        </section>

        <form
          action={createSalidaAction}
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
          <Section title="Datos de la salida">
            <FormGrid>
              <label style={fieldStyle}>
                Fecha
                <input
                  name="fecha"
                  type="date"
                  defaultValue={selectedFecha}
                  required
                  style={inputStyle}
                />
              </label>

              <label style={fieldStyle}>
                Hora
                <input
                  name="hora"
                  type="time"
                  defaultValue={nowInLima()}
                  required
                  style={inputStyle}
                />
              </label>

              <label style={fieldStyle}>
                Sede
                <select
                  name="sede"
                  defaultValue={selectedSede === "TODAS" ? "Miraflores" : selectedSede}
                  required
                  style={inputStyle}
                >
                  <Options rows={sedes} fallback={["Miraflores", "San Borja"]} />
                </select>
              </label>

              <label style={fieldStyle}>
                Tipo de gasto
                <select name="tipo_gasto" required style={inputStyle}>
                  <Options
                    rows={tiposGasto}
                    fallback={[
                      "Movilidad",
                      "Insumos",
                      "Limpieza",
                      "Alquiler",
                      "Servicios",
                      "Apoyo Therapy",
                      "Otro",
                    ]}
                  />
                </select>
              </label>
            </FormGrid>
          </Section>

          <Section title="Detalle">
            <FormGrid>
              <label style={fieldStyle}>
                Concepto
                <input
                  name="concepto"
                  placeholder="Ej. Compra de aceite, movilidad, limpieza, etc."
                  required
                  style={inputStyle}
                />
              </label>

              <label style={fieldStyle}>
                Monto
                <input
                  name="monto"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  required
                  style={inputStyle}
                />
              </label>

              <label style={fieldStyle}>
                Responsable
                <select name="responsable" defaultValue="Gerald" style={inputStyle}>
                  <Options
                    rows={responsables}
                    fallback={["Gerald", "Luis", "Naty", "Otro"]}
                  />
                </select>
              </label>

              <label style={fieldStyle}>
                Movimiento relacionado
                <input
                  name="source_movimiento_id"
                  placeholder="Opcional. Ej. MOV-APP-..."
                  style={inputStyle}
                />
              </label>
            </FormGrid>
          </Section>

          <Section title="Observación">
            <label style={fieldStyle}>
              Nota interna
              <textarea
                name="observacion"
                placeholder="Ej. Gasto real, comprobante pendiente, diferencia explicada, etc."
                rows={4}
                style={{
                  ...inputStyle,
                  resize: "vertical",
                  minHeight: "110px",
                }}
              />
            </label>
          </Section>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "12px",
              flexWrap: "wrap",
            }}
          >
            <a
              href="/citas-hoy"
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
              Volver a citas
            </a>

            <SubmitButton
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
              Guardar salida
            </SubmitButton>
          </div>
        </form>

        <section className="panel">
          <div className="panelTitle">
            <div>
              <h2>Salidas registradas</h2>
              <p>
                Vista rápida para validar lo ingresado en {dateLabel(selectedFecha)} en {sedeLabel}.
              </p>
            </div>
          </div>

          {salidas.data.length === 0 ? (
            <div className="alert" style={{ marginBottom: 0 }}>
              No hay salidas registradas para la fecha y sede seleccionadas.
            </div>
          ) : (
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>Sede</th>
                    <th>Tipo</th>
                    <th>Concepto</th>
                    <th>Monto</th>
                    <th>Responsable</th>
                    <th>Observación</th>
                    <th>ID</th>
                  </tr>
                </thead>
                <tbody>
                  {salidas.data.map((row) => (
                    <tr key={row.salida_id}>
                      <td>{String(row.hora ?? "-").slice(0, 5)}</td>
                      <td>{row.sede}</td>
                      <td>{row.tipo_gasto}</td>
                      <td className="strong">{row.concepto}</td>
                      <td>{money(row.monto)}</td>
                      <td>{row.responsable || "-"}</td>
                      <td>{row.observacion || "-"}</td>
                      <td>{row.salida_id}</td>
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

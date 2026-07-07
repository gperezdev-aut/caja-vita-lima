import { requireAuth } from "@/lib/auth";
import { supabaseSelect } from "@/lib/supabaseServer";
import { createAtencionAction } from "./actions";

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

export default async function NuevaAtencionPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAuth();

  const params = await searchParams;
  const config = await supabaseSelect<Row>("config_listas");

  const sedes = list(config.data, "SEDES");
  const servicios = list(config.data, "SERVICIOS");
  const metodos = list(config.data, "METODOS_PAGO");
  const terapistas = list(config.data, "TERAPISTAS");
  const estadosBoleta = list(config.data, "ESTADO_BOLETA");
  const responsables = list(config.data, "RESPONSABLES");

  return (
    <main className="appShell">
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
          <a href="/comprobantes">Comprobantes</a>
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

      <section className="page">
        <section className="hero" style={{ minHeight: "140px" }}>
          <div>
            <p className="eyebrow">Operación</p>
            <h1>Nueva atención</h1>
            <p className="subtitle">
              Registra una atención o reserva manual. Guardará datos en
              clientes, citas, movimientos, pagos y detalle de atención.
            </p>
          </div>

          <div className="badge">
            <span>Modo</span>
            <strong>Registro</strong>
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
            Registro guardado correctamente. Movimiento:{" "}
            <strong>{params.id}</strong>
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

        {config.error && (
          <div className="alert">
            No se pudieron cargar listas desde Supabase. El formulario usará
            opciones básicas.
          </div>
        )}

        <form
          action={createAtencionAction}
          style={{
            background: "rgba(255, 250, 241, 0.9)",
            border: "1px solid var(--line)",
            borderRadius: "26px",
            boxShadow: "var(--shadow)",
            padding: "24px",
            display: "grid",
            gap: "22px",
          }}
        >
          <Section title="Datos de la operación">
            <FormGrid>
              <label style={fieldStyle}>
                Tipo de registro
                <select name="tipo_registro" defaultValue="ATENCION" style={inputStyle}>
                  <option value="ATENCION">Atención de hoy / sin cita</option>
                  <option value="RESERVA">Reserva futura</option>
                </select>
              </label>

              <label style={fieldStyle}>
                Fecha
                <input name="fecha" type="date" defaultValue={todayInLima()} required style={inputStyle} />
              </label>

              <label style={fieldStyle}>
                Hora
                <input name="hora" type="time" required style={inputStyle} />
              </label>

              <label style={fieldStyle}>
                Sede
                <select name="sede" required style={inputStyle}>
                  <Options rows={sedes} fallback={["Miraflores", "San Borja"]} />
                </select>
              </label>
            </FormGrid>
          </Section>

          <Section title="Cliente">
            <FormGrid>
              <label style={fieldStyle}>
                Cliente
                <input name="cliente" placeholder="Nombre del cliente" required style={inputStyle} />
              </label>

              <label style={fieldStyle}>
                WhatsApp
                <input name="whatsapp" placeholder="Ej. 987654321" style={inputStyle} />
              </label>

              <label style={fieldStyle}>
                DNI
                <input name="dni" placeholder="Opcional" style={inputStyle} />
              </label>

              <label style={fieldStyle}>
                N° personas
                <select name="n_pax" defaultValue="1" style={inputStyle}>
                  <option value="1">1 persona</option>
                  <option value="2">2 personas</option>
                </select>
              </label>
            </FormGrid>
          </Section>

          <Section title="Servicio y terapistas">
            <FormGrid>
              <label style={fieldStyle}>
                Servicio
                <select name="servicio" required style={inputStyle}>
                  <Options
                    rows={servicios}
                    fallback={[
                      "Masaje relajante",
                      "Masaje descontracturante",
                      "Masaje terapéutico 60 min",
                      "Personalizado",
                    ]}
                  />
                </select>
              </label>

              <label style={fieldStyle}>
                Duración
                <select name="duracion" defaultValue="60 min" style={inputStyle}>
                  <option value="45 min">45 min</option>
                  <option value="60 min">60 min</option>
                  <option value="70 min">70 min</option>
                  <option value="90 min">90 min</option>
                  <option value="120 min">120 min</option>
                </select>
              </label>

              <label style={fieldStyle}>
                Terapista 1
                <select name="terapista_1" style={inputStyle}>
                  <option value="">Por asignar</option>
                  <Options rows={terapistas} fallback={["Rossana", "Maria E", "Melissa", "Cecilia", "Otro"]} />
                </select>
              </label>

              <label style={fieldStyle}>
                Terapista 2
                <select name="terapista_2" style={inputStyle}>
                  <option value="">No aplica / Por asignar</option>
                  <Options rows={terapistas} fallback={["Rossana", "Maria E", "Melissa", "Cecilia", "Otro"]} />
                </select>
              </label>
            </FormGrid>
          </Section>

          <Section title="Pago y comprobante">
            <FormGrid>
              <label style={fieldStyle}>
                Monto total
                <input name="monto_total" type="number" step="0.01" min="0" placeholder="0.00" required style={inputStyle} />
              </label>

              <label style={fieldStyle}>
                Monto pagado / adelanto
                <input name="monto_pagado" type="number" step="0.01" min="0" placeholder="0.00" required style={inputStyle} />
              </label>

              <label style={fieldStyle}>
                Método de pago
                <select name="metodo_pago" style={inputStyle}>
                  <Options rows={metodos} fallback={["EFECTIVO", "YAPE", "PLIN", "IZIPAY POS", "BCP", "OTRO"]} />
                </select>
              </label>

              <label style={fieldStyle}>
                Estado boleta
                <select name="estado_boleta" defaultValue="Pendiente" style={inputStyle}>
                  <Options rows={estadosBoleta} fallback={["Emitida", "Pendiente", "No aplica", "Anulada"]} />
                </select>
              </label>

              <label style={fieldStyle}>
                Número boleta/factura
                <input name="numero_boleta" placeholder="Opcional" style={inputStyle} />
              </label>

              <label style={fieldStyle}>
                Responsable
                <select name="responsable" defaultValue="Gerald" style={inputStyle}>
                  <Options rows={responsables} fallback={["Gerald", "Luis", "Naty", "Otro"]} />
                </select>
              </label>
            </FormGrid>
          </Section>

          <Section title="Observación">
            <label style={fieldStyle}>
              Nota interna
              <textarea
                name="observacion"
                placeholder="Ej. Cliente llega directo, reserva por WhatsApp, pendiente de boleta, etc."
                rows={4}
                style={{ ...inputStyle, resize: "vertical", minHeight: "110px" }}
              />
            </label>
          </Section>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", flexWrap: "wrap" }}>
            <a className="ghostButton" href="/" style={{
              background: "white",
              color: "var(--green)",
              border: "1px solid var(--line)",
              borderRadius: "16px",
              padding: "15px 18px",
              fontWeight: 850,
              textDecoration: "none",
            }}>
              Volver al dashboard
            </a>
            <button type="submit" style={{
              border: 0,
              borderRadius: "16px",
              padding: "15px 18px",
              fontWeight: 850,
              cursor: "pointer",
              background: "var(--green)",
              color: "white",
            }}>
              Guardar atención
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
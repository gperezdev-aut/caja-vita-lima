import { logoutAction } from "@/app/actions";
import { requireAuth } from "@/lib/auth";
import { supabaseSelect } from "@/lib/supabaseServer";

type Row = Record<string, any>;

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

function monthLabel(value: any) {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString("es-PE", {
    month: "long",
    year: "numeric",
  });
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

function AlertBox({ children }: { children: React.ReactNode }) {
  return <div className="alert">{children}</div>;
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

      <form action={logoutAction}>
        <button className="logoutButton" type="submit">
          Cerrar sesión
        </button>
      </form>
    </aside>
  );
}

export default async function HomePage() {
  await requireAuth();

  const resumen = await supabaseSelect<Row>(
    "vista_reporte_socio_resumen_con_alertas_v3"
  );
  const mensual = await supabaseSelect<Row>("vista_reporte_socio_mensual");
  const mesActual = await supabaseSelect<Row>("vista_reporte_socio_mes_actual");
  const comprobantes = await supabaseSelect<Row>(
    "vista_comprobantes_control_resumen"
  );
  const salidasSinFecha = await supabaseSelect<Row>(
    "vista_salidas_sin_fecha_resumen"
  );

  const errors = [
    resumen.error,
    mensual.error,
    mesActual.error,
    comprobantes.error,
    salidasSinFecha.error,
  ].filter(Boolean);

  const r = resumen.data?.[0] ?? {};
  const actual = mesActual.data?.[0] ?? {};
  const sinFecha = salidasSinFecha.data?.[0] ?? {};

  return (
    <main className="appShell">
      <Sidebar />

      <section className="page">
        <section className="hero" id="dashboard">
          <div>
            <p className="eyebrow">Vita Lima Spa</p>
            <h1>Caja Vita Lima</h1>
            <p className="subtitle">
              Dashboard interno conectado a Supabase. Reporte de ingresos,
              salidas, comprobantes y alertas de migración.
            </p>
          </div>

          <div className="badge">
            <span>Estado</span>
            <strong>Protegido</strong>
          </div>
        </section>

        {errors.length > 0 && (
          <AlertBox>
            <strong>Revisar conexión:</strong>
            <ul>
              {errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </AlertBox>
        )}

        <section className="grid">
          <Card
            label="Ingresos confirmados"
            value={money(r["Total ingresos confirmados"])}
            tone="good"
          />
          <Card label="Total salidas" value={money(r["Total salidas"])} />
          <Card
            label="Resultado neto"
            value={money(r["Resultado neto confirmado"])}
            tone="good"
          />
          <Card
            label="Pendientes migración"
            value={numberFmt(r["Total filas pendientes"])}
            tone="warn"
          />
        </section>

        <section className="grid secondary">
          <Card label="Servicios" value={money(r["Total servicios"])} />
          <Card label="Gift Cards" value={money(r["Total Gift Cards"])} />
          <Card
            label="Préstamos de caja"
            value={money(r["Total préstamos de caja"])}
          />
          <Card
            label="Cuponidad en caja"
            value={money(r["Total Cuponidad en caja"])}
          />
        </section>

        <section className="panel">
          <div className="panelTitle">
            <div>
              <h2>Último mes cargado</h2>
              <p>
                Si el mes todavía no terminó, tomarlo como información
                preliminar.
              </p>
            </div>
          </div>

          <div className="currentMonth">
            <div>
              <span>Mes</span>
              <strong>{monthLabel(actual.mes)}</strong>
            </div>
            <div>
              <span>Ingresos</span>
              <strong>{money(actual["Total ingresos confirmados"])}</strong>
            </div>
            <div>
              <span>Salidas</span>
              <strong>{money(actual["Total salidas"])}</strong>
            </div>
            <div>
              <span>Neto</span>
              <strong>{money(actual["Resultado neto confirmado"])}</strong>
            </div>
          </div>
        </section>

        <section className="panel" id="mensual">
          <div className="panelTitle">
            <div>
              <h2>Reporte mensual</h2>
              <p>Vista ejecutiva por mes y sede.</p>
            </div>
          </div>

          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Mes</th>
                  <th>Sede</th>
                  <th>Servicios</th>
                  <th>Gift Cards</th>
                  <th>Préstamos</th>
                  <th>Total ingresos</th>
                  <th>Salidas</th>
                  <th>Neto</th>
                  <th>Pendientes</th>
                </tr>
              </thead>
              <tbody>
                {mensual.data.map((row) => (
                  <tr key={`${row.mes}-${row.sede}`}>
                    <td>{monthLabel(row.mes)}</td>
                    <td>{row.sede}</td>
                    <td>{money(row["Ingresos por servicios"])}</td>
                    <td>{money(row["Ingresos por Gift Cards"])}</td>
                    <td>{money(row["Préstamos de caja"])}</td>
                    <td>{money(row["Total ingresos confirmados"])}</td>
                    <td>{money(row["Total salidas"])}</td>
                    <td className="strong">
                      {money(row["Resultado neto confirmado"])}
                    </td>
                    <td>{numberFmt(row["Filas pendientes de revisión"])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="twoCols">
          <div className="panel" id="comprobantes">
            <div className="panelTitle">
              <div>
                <h2>Comprobantes</h2>
                <p>Resumen para revisión de boletas/facturas.</p>
              </div>
            </div>

            <div className="miniList">
              {comprobantes.data.map((row, index) => (
                <div className="miniItem" key={index}>
                  <span>
                    {row.estado_comprobante_final_calculado} ·{" "}
                    {row.tipo_comprobante}
                  </span>
                  <strong>
                    {numberFmt(row.cantidad)} / {money(row.total_importe)}
                  </strong>
                </div>
              ))}
            </div>
          </div>

          <div className="panel" id="alertas">
            <div className="panelTitle">
              <div>
                <h2>Alertas</h2>
                <p>Puntos visibles para no perder control.</p>
              </div>
            </div>

            <div className="miniList">
              <div className="miniItem">
                <span>Salidas sin fecha</span>
                <strong>
                  {numberFmt(sinFecha.total_salidas_sin_fecha)} /{" "}
                  {money(sinFecha.total_monto_sin_fecha)}
                </strong>
              </div>
              <div className="miniItem">
                <span>Comprobantes para revisar</span>
                <strong>
                  {numberFmt(r["Comprobantes para revisar"])} /{" "}
                  {money(r["Monto comprobantes para revisar"])}
                </strong>
              </div>
              <div className="miniItem">
                <span>Comprobantes OK</span>
                <strong>{numberFmt(r["Comprobantes OK completos"])}</strong>
              </div>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

import { requireModuleAccess } from "@/lib/auth";
import { CajaSidebar } from "@/components/CajaSidebar";
import { supabaseSelect } from "@/lib/supabaseServer";
import Link from "next/link";
import { FormField } from "@/components/FormField";
import { Input } from "@/components/Input";
import { Select } from "@/components/Select";
import {
  TODAS_LAS_SEDES,
  getCuponidadFromMonthlyRow,
  getDashboardTotals,
  getNumber,
  monthLabel,
  normalizeMonth,
  resolveDashboardFilters,
  type Row,
} from "@/lib/dashboardTotals";

type SearchParams = Promise<{
  desde?: string;
  hasta?: string;
  sede?: string;
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

export default async function HomePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireModuleAccess("dashboard");
  const params = await searchParams;

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
  const sinFecha = salidasSinFecha.data?.[0] ?? {};

  const { desde, hasta, selectedSede, filterActive, filteredMonthlyRows } =
    resolveDashboardFilters({ params, mensualRows: mensual.data });

  const sedes = Array.from(
    new Set(
      mensual.data
        .map((row) => String(row.sede ?? "").trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "es"));

  const dashboardTotals = getDashboardTotals({
    filterActive,
    resumenRow: r,
    filteredMonthlyRows,
  });

  const rowsForTable = filterActive ? filteredMonthlyRows : mensual.data;

  const latestMonthWithMovement = [...mensual.data]
    .filter((row) => {
      const totalIngresos = getNumber(row, "Total ingresos confirmados");
      const totalSalidas = getNumber(row, "Total salidas");
      return totalIngresos !== 0 || totalSalidas !== 0;
    })
    .sort((a, b) => normalizeMonth(b.mes).localeCompare(normalizeMonth(a.mes)))[0];

  const latestMonth = latestMonthWithMovement ?? mesActual.data?.[0] ?? {};
  const rangeLabel = filterActive
    ? `${monthLabel(desde)} a ${monthLabel(hasta)}`
    : "Todo lo cargado";

  const sedeLabel = selectedSede === TODAS_LAS_SEDES ? "Todas las sedes" : selectedSede;

  return (
    <main className="appShell">
      <CajaSidebar session={session} />

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
            <span>Periodo</span>
            <strong>{filterActive ? "Filtrado" : "General"}</strong>
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

        <section className="panel">
          <div className="panelTitle">
            <div>
              <h2>Filtros del dashboard</h2>
              <p>
                Consulta por mes, rango de meses y sede sin cambiar las vistas
                de Supabase.
              </p>
            </div>
          </div>

          <form
            action="/"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "14px",
              alignItems: "end",
            }}
          >
            <FormField label="Desde">
              <Input name="desde" type="month" defaultValue={desde} />
            </FormField>

            <FormField label="Hasta">
              <Input name="hasta" type="month" defaultValue={hasta} />
            </FormField>

            <FormField label="Sede">
              <Select name="sede" defaultValue={selectedSede}>
                <option value={TODAS_LAS_SEDES}>Todas las sedes</option>
                {sedes.map((sede) => (
                  <option key={sede} value={sede}>
                    {sede}
                  </option>
                ))}
              </Select>
            </FormField>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
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
                Aplicar filtros
              </button>

              <Link
                href="/"
                style={{
                  background: "white",
                  color: "var(--green)",
                  border: "1px solid var(--line)",
                  borderRadius: "16px",
                  padding: "15px 18px",
                  fontWeight: 850,
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                Ver todo
              </Link>

              <a
                href={`/api/dashboard/export?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}&sede=${encodeURIComponent(selectedSede)}`}
                style={{
                  background: "white",
                  color: "var(--green)",
                  border: "1px solid var(--line)",
                  borderRadius: "16px",
                  padding: "15px 18px",
                  fontWeight: 850,
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                Descargar Excel
              </a>
            </div>
          </form>
        </section>

        <section className="grid">
          <Card
            label="Ingresos confirmados"
            value={money(dashboardTotals.ingresos)}
            tone="good"
          />
          <Card label="Total salidas" value={money(dashboardTotals.salidas)} />
          <Card
            label="Resultado neto"
            value={money(dashboardTotals.neto)}
            tone="good"
          />
          <Card
            label="Pendientes migración"
            value={numberFmt(dashboardTotals.pendientes)}
            tone="warn"
          />
        </section>

        <section className="grid secondary">
          <Card label="Servicios" value={money(dashboardTotals.servicios)} />
          <Card label="Gift Cards" value={money(dashboardTotals.giftCards)} />
          <Card
            label="Préstamos de caja"
            value={money(dashboardTotals.prestamos)}
          />
          <Card
            label="Cuponidad en caja"
            value={money(dashboardTotals.cuponidad)}
          />
        </section>

        <section className="panel">
          <div className="panelTitle">
            <div>
              <h2>{filterActive ? "Periodo seleccionado" : "Resumen general"}</h2>
              <p>
                {filterActive
                  ? "Los importes se calculan desde la vista mensual para el rango elegido."
                  : "Vista acumulada general. El último mes mostrado ignora meses sin movimiento."}
              </p>
            </div>
          </div>

          {filterActive ? (
            <div className="currentMonth">
              <div>
                <span>Desde</span>
                <strong>{monthLabel(desde)}</strong>
              </div>
              <div>
                <span>Hasta</span>
                <strong>{monthLabel(hasta)}</strong>
              </div>
              <div>
                <span>Sede</span>
                <strong>{sedeLabel}</strong>
              </div>
              <div>
                <span>Filas mensuales</span>
                <strong>{numberFmt(filteredMonthlyRows.length)}</strong>
              </div>
            </div>
          ) : (
            <div className="currentMonth">
              <div>
                <span>Vista</span>
                <strong>{rangeLabel}</strong>
              </div>
              <div>
                <span>Último mes con movimiento</span>
                <strong>{monthLabel(latestMonth.mes)}</strong>
              </div>
              <div>
                <span>Ingresos del último mes</span>
                <strong>{money(latestMonth["Total ingresos confirmados"])}</strong>
              </div>
              <div>
                <span>Neto del último mes</span>
                <strong>{money(latestMonth["Resultado neto confirmado"])}</strong>
              </div>
            </div>
          )}
        </section>

        <section className="panel" id="mensual">
          <div className="panelTitle">
            <div>
              <h2>Reporte mensual</h2>
              <p>
                {filterActive
                  ? `Vista filtrada: ${rangeLabel} · ${sedeLabel}.`
                  : "Vista ejecutiva por mes y sede."}
              </p>
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
                  <th>Cuponidad</th>
                  <th>Total ingresos</th>
                  <th>Salidas</th>
                  <th>Neto</th>
                  <th>Pendientes</th>
                </tr>
              </thead>
              <tbody>
                {rowsForTable.length === 0 ? (
                  <tr>
                    <td colSpan={10}>No hay información para el filtro seleccionado.</td>
                  </tr>
                ) : (
                  rowsForTable.map((row) => (
                    <tr key={`${row.mes}-${row.sede}`}>
                      <td>{monthLabel(row.mes)}</td>
                      <td>{row.sede}</td>
                      <td>{money(row["Ingresos por servicios"])}</td>
                      <td>{money(row["Ingresos por Gift Cards"])}</td>
                      <td>{money(row["Préstamos de caja"])}</td>
                      <td>{money(getCuponidadFromMonthlyRow(row))}</td>
                      <td>{money(row["Total ingresos confirmados"])}</td>
                      <td>{money(row["Total salidas"])}</td>
                      <td className="strong">
                        {money(row["Resultado neto confirmado"])}
                      </td>
                      <td>{numberFmt(row["Filas pendientes de revisión"])}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="twoCols">
          <div className="panel" id="comprobantes">
            <div className="panelTitle">
              <div>
                <h2>Comprobantes</h2>
                <p>Resumen general para revisión de boletas/facturas.</p>
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

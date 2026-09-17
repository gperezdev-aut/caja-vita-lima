import { requireModuleAccess } from "@/lib/auth";
import { CajaSidebar } from "@/components/CajaSidebar";
import { supabaseSelect } from "@/lib/supabaseServer";
import Link from "next/link";
import { FormField } from "@/components/FormField";
import { Input } from "@/components/Input";
import { Select } from "@/components/Select";
import styles from "./dashboard-mobile.module.css";
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

function comprobanteLabel(row: Row) {
  const estado = String(row.estado_comprobante_final_calculado ?? "").toUpperCase();
  const tipo = String(row.tipo_comprobante ?? "").toUpperCase();

  if (estado === "OK_COMPLETO") return tipo === "FACTURA" ? "Facturas completas" : "Boletas completas";
  if (estado === "PENDIENTE") return "Comprobantes pendientes";
  if (estado === "OBSERVAR") return "Requieren revisión";
  if (estado === "SIN_NUMERO") return "Sin número";
  if (tipo === "POR_DEFINIR") return "Comprobantes por definir";
  if (tipo === "NO_APLICA") return "No aplica";

  return [estado, tipo].filter(Boolean).join(" · ") || "Comprobantes";
}

function KpiCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "blue" | "warn" | "exit";
}) {
  const toneClass =
    tone === "good"
      ? styles.kpiGood
      : tone === "blue"
        ? styles.kpiBlue
        : tone === "warn"
          ? styles.kpiWarn
          : tone === "exit"
            ? styles.kpiExit
            : "";

  return (
    <div className={`${styles.kpiCard} ${toneClass}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SmallCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.smallCard}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.statRow}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AlertBox({ children }: { children: React.ReactNode }) {
  return <div className="alert dashboardErrors">{children}</div>;
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

      <section className={`page dashboardPage ${styles.dashboardPage}`}>
        <section className={`hero dashboardHero ${styles.heroCompact}`} id="dashboard">
          <div className={styles.heroCopy}>
            <p className={styles.kicker}>Vita Lima Spa</p>
            <div className={styles.heroTitleRow}>
              <h1>Caja Vita Lima</h1>
              <span className={styles.protectedBadge}>Protegido</span>
            </div>
            <p className={styles.heroSubtitle}>Dashboard interno de caja y operaciones.</p>
          </div>

          <div className={styles.periodBadge}>
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

        <section className={styles.kpiGrid} aria-label="Resumen financiero principal">
          <KpiCard label="Ingresos confirmados" value={money(dashboardTotals.ingresos)} tone="good" />
          <KpiCard label="Total salidas" value={money(dashboardTotals.salidas)} tone="exit" />
          <KpiCard label="Resultado neto" value={money(dashboardTotals.neto)} tone="blue" />
          <KpiCard label="Pendientes migración" value={numberFmt(dashboardTotals.pendientes)} tone="warn" />
        </section>

        <section className={styles.filterPanel}>
          <div className={styles.filterHeading}>
            <div>
              <h2>Filtros del dashboard</h2>
              <p>Consulta por mes, rango de meses y sede.</p>
            </div>
            <span className={styles.filterHint}>Consulta y analiza tu información.</span>
          </div>

          <form action="/" className={styles.filterForm}>
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

            <div className={styles.filterActions}>
              <button type="submit" className={styles.primaryAction}>
                Aplicar filtros
              </button>
              <Link href="/" className={styles.secondaryAction}>
                Ver todo
              </Link>
              <a
                href={`/api/dashboard/export?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}&sede=${encodeURIComponent(selectedSede)}`}
                className={styles.secondaryAction}
              >
                Descargar Excel
              </a>
            </div>
          </form>
        </section>

        <section className={styles.smallGrid} aria-label="Desglose de ingresos">
          <SmallCard label="Servicios" value={money(dashboardTotals.servicios)} />
          <SmallCard label="Gift Cards" value={money(dashboardTotals.giftCards)} />
          <SmallCard label="Préstamos de caja" value={money(dashboardTotals.prestamos)} />
          <SmallCard label="Cuponidad en caja" value={money(dashboardTotals.cuponidad)} />
        </section>

        <section className={styles.infoGrid}>
          <div className={styles.compactPanel}>
            <div className={styles.compactPanelTitle}>
              <h2>{filterActive ? "Periodo seleccionado" : "Resumen general"}</h2>
            </div>
            <div className={styles.statRows}>
              {filterActive ? (
                <>
                  <StatRow label="Desde" value={monthLabel(desde)} />
                  <StatRow label="Hasta" value={monthLabel(hasta)} />
                  <StatRow label="Sede" value={sedeLabel} />
                  <StatRow label="Filas mensuales" value={numberFmt(filteredMonthlyRows.length)} />
                </>
              ) : (
                <>
                  <StatRow label="Vista" value={rangeLabel} />
                  <StatRow label="Último mes con movimiento" value={monthLabel(latestMonth.mes)} />
                  <StatRow label="Ingresos del último mes" value={money(latestMonth["Total ingresos confirmados"])} />
                  <StatRow label="Neto del último mes" value={money(latestMonth["Resultado neto confirmado"])} />
                </>
              )}
            </div>
          </div>

          <div className={styles.compactPanel} id="comprobantes">
            <div className={styles.compactPanelTitle}>
              <h2>Comprobantes</h2>
            </div>
            <div className={styles.statRows}>
              {comprobantes.data.map((row, index) => (
                <StatRow
                  key={index}
                  label={comprobanteLabel(row)}
                  value={`${numberFmt(row.cantidad)} / ${money(row.total_importe)}`}
                />
              ))}
            </div>
          </div>

          <div className={styles.compactPanel} id="alertas">
            <div className={styles.compactPanelTitle}>
              <h2>Alertas</h2>
            </div>
            <div className={styles.statRows}>
              <StatRow
                label="Salidas sin fecha"
                value={`${numberFmt(sinFecha.total_salidas_sin_fecha)} / ${money(sinFecha.total_monto_sin_fecha)}`}
              />
              <StatRow
                label="Comprobantes por revisar"
                value={`${numberFmt(r["Comprobantes para revisar"])} / ${money(r["Monto comprobantes para revisar"])}`}
              />
              <StatRow label="Comprobantes OK" value={numberFmt(r["Comprobantes OK completos"])} />
            </div>
          </div>

          <div className={`${styles.compactPanel} ${styles.monthlyPanel}`} id="mensual">
            <div className={styles.compactPanelTitle}>
              <h2>Reporte mensual</h2>
              <p>{filterActive ? `${rangeLabel} · ${sedeLabel}` : "Vista ejecutiva por mes y sede."}</p>
            </div>

            <div className={styles.monthList}>
              {rowsForTable.length === 0 ? (
                <div className={styles.monthItem}>
                  <div style={{ padding: "12px" }}>No hay información para el filtro seleccionado.</div>
                </div>
              ) : (
                rowsForTable.map((row) => (
                  <details className={styles.monthItem} key={`${row.mes}-${row.sede}`}>
                    <summary>
                      <span className={styles.monthSummaryMain}>
                        <span>{monthLabel(row.mes)} · {row.sede}</span>
                        <small>Ingresos {money(row["Total ingresos confirmados"])}</small>
                      </span>
                      <strong className={styles.monthNet}>{money(row["Resultado neto confirmado"])}</strong>
                    </summary>
                    <div className={styles.monthDetail}>
                      <div><span>Servicios</span><strong>{money(row["Ingresos por servicios"])}</strong></div>
                      <div><span>Gift Cards</span><strong>{money(row["Ingresos por Gift Cards"])}</strong></div>
                      <div><span>Préstamos</span><strong>{money(row["Préstamos de caja"])}</strong></div>
                      <div><span>Cuponidad</span><strong>{money(getCuponidadFromMonthlyRow(row))}</strong></div>
                      <div><span>Salidas</span><strong>{money(row["Total salidas"])}</strong></div>
                      <div><span>Pendientes</span><strong>{numberFmt(row["Filas pendientes de revisión"])}</strong></div>
                    </div>
                  </details>
                ))
              )}
            </div>
          </div>
        </section>

        <section className={`${styles.compactPanel} ${styles.desktopTable}`} aria-label="Reporte mensual en tabla">
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
                    <tr key={`desktop-${row.mes}-${row.sede}`}>
                      <td>{monthLabel(row.mes)}</td>
                      <td>{row.sede}</td>
                      <td>{money(row["Ingresos por servicios"])}</td>
                      <td>{money(row["Ingresos por Gift Cards"])}</td>
                      <td>{money(row["Préstamos de caja"])}</td>
                      <td>{money(getCuponidadFromMonthlyRow(row))}</td>
                      <td>{money(row["Total ingresos confirmados"])}</td>
                      <td>{money(row["Total salidas"])}</td>
                      <td className="strong">{money(row["Resultado neto confirmado"])}</td>
                      <td>{numberFmt(row["Filas pendientes de revisión"])}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

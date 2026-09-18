import { requireModuleAccess } from "@/lib/auth";
import { CajaSidebar } from "@/components/CajaSidebar";
import { supabaseSelect, supabaseSelectAllWhere, supabaseSelectWhere } from "@/lib/supabaseServer";
import {
  METODOS_CIERRE,
  cajaFisicaNoCalculable,
  resumirDineroProcesadoCierre,
  resumirMovimientosOperativos,
  sumarSalidas,
} from "@/lib/cierreCaja";
import { FormField } from "@/components/FormField";
import { Input } from "@/components/Input";
import { Select } from "@/components/Select";
import { Badge } from "@/components/Badge";
import { createCierreCajaAction } from "./actions";
import { CierreCajaWizard } from "./CierreCajaWizard.tsx";

type Row = Record<string, any>;

type SearchParams = Promise<{
  ok?: string;
  id?: string;
  error?: string;
  fecha?: string;
  sede?: string;
}>;

function money(value: any) {
  const numberValue = Number(value ?? 0);

  return `S/ ${numberValue.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function physicalMoney(value: unknown) {
  return value == null ? "No calculable" : money(value);
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

function values(rows: Row[], fallback: string[]) {
  return rows.length ? rows.map((row) => String(row.valor)) : fallback;
}

function FormGrid({ children }: { children: React.ReactNode }) {
  return <div className="formGrid">{children}</div>;
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

function safeDate(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  return value;
}

function safeCierreSede(value: string | undefined) {
  if (!value) return "Miraflores";

  const allowed = ["Miraflores", "San Borja"];
  return allowed.includes(value) ? value : "Miraflores";
}

export default async function CierreCajaPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireModuleAccess("cierre-caja");

  const params = await searchParams;
  const today = todayInLima();
  const selectedFecha = safeDate(params?.fecha, today);
  const selectedSede = safeCierreSede(params?.sede);

  const [config, pagos, propinas, movimientos, salidas, cierres] = await Promise.all([
    supabaseSelect<Row>("config_listas"),
    supabaseSelectAllWhere<Row>(
      "caja_pagos",
      [
        "select=pago_id,fecha,hora,sede,metodo,monto",
        `fecha=eq.${selectedFecha}`,
        `sede=eq.${encodeURIComponent(selectedSede)}`,
      ].join("&")
    ),
    supabaseSelectAllWhere<Row>(
      "caja_propinas",
      [
        "select=propina_id,fecha,hora,sede,metodo,monto,estado",
        `fecha=eq.${selectedFecha}`,
        `sede=eq.${encodeURIComponent(selectedSede)}`,
      ].join("&")
    ),
    supabaseSelectAllWhere<Row>(
      "caja_movimientos",
      [
        "select=movimiento_id,fecha,sede,n_pax,estado_comprobante_manual,tipo_comprobante,estado_boleta",
        `fecha=eq.${selectedFecha}`,
        `sede=eq.${encodeURIComponent(selectedSede)}`,
      ].join("&")
    ),
    supabaseSelectAllWhere<Row>(
      "caja_salidas",
      [
        "select=salida_id,fecha,sede,monto",
        `fecha=eq.${selectedFecha}`,
        `sede=eq.${encodeURIComponent(selectedSede)}`,
      ].join("&")
    ),
    supabaseSelectWhere<Row>(
      "caja_cierres",
      [
        "select=cierre_id,fecha,sede,total_ingresos,total_propinas,total_procesado,total_salidas,caja_esperada,diferencia,responsable,estado,observacion,created_at",
        `fecha=eq.${selectedFecha}`,
        `sede=eq.${encodeURIComponent(selectedSede)}`,
        "order=created_at.desc",
      ].join("&")
    ),
  ]);

  const sedes = list(config.data, "SEDES");
  const responsables = list(config.data, "RESPONSABLES");
  const responsableValues = values(responsables, ["Gerald", "Luis", "Naty", "Otro"]);

  const errors = [config.error, pagos.error, propinas.error, movimientos.error, salidas.error, cierres.error].filter(Boolean);
  const dineroProcesado = resumirDineroProcesadoCierre(pagos.data, propinas.data);
  const metodosConMovimiento = METODOS_CIERRE.filter((metodo) => Number(dineroProcesado.porMetodo[metodo] ?? 0) > 0.009);
  const resumenPagos = dineroProcesado.ingresos;
  const resumenPropinas = dineroProcesado.propinas;
  const totalIngresos = resumenPagos.total;
  const totalSalidas = sumarSalidas(salidas.data);
  const { paxTotal, boletasPendientes } = resumirMovimientosOperativos(movimientos.data);
  const { cajaEsperada, diferencia } = cajaFisicaNoCalculable();

  return (
    <main className="appShell">
      <CajaSidebar session={session} />

      <section className="page cierreCajaPage">
        <section className="hero" style={{ minHeight: "150px" }}>
          <div>
            <p className="eyebrow">Control diario</p>
            <h1>Cierre de caja</h1>
            <p className="subtitle">
              Registra el cierre diario por sede. Ingresos de Vita Lima y propinas de terapistas se concilian por separado para {dateLabel(selectedFecha)} en {selectedSede}.
            </p>
          </div>

          <div className="badge">
            <span>Cierres</span>
            <strong>{cierres.data.length}</strong>
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
            Cierre guardado correctamente. ID: <strong>{params.id}</strong>
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
              <p>Consulta y prepara cierres por fecha y sede.</p>
            </div>
          </div>

          <form method="get" action="/cierre-caja">
            <FormGrid>
              <FormField label="Fecha">
                <Input
                  name="fecha"
                  type="date"
                  defaultValue={selectedFecha}
                  required
                />
              </FormField>

              <FormField label="Sede">
                <Select name="sede" defaultValue={selectedSede} required>
                  <Options rows={sedes} fallback={["Miraflores", "San Borja"]} />
                </Select>
              </FormField>

              <div className="filterActions operationalFilterActions">
                <button className="primaryButton" type="submit">
                  Aplicar filtros
                </button>

                <a className="ghostButton" href="/cierre-caja">
                  Ver hoy
                </a>
              </div>
            </FormGrid>
          </form>
        </section>

        <CierreCajaWizard
          action={createCierreCajaAction}
          fecha={selectedFecha}
          sede={selectedSede}
          responsables={responsableValues}
          totalIngresos={totalIngresos}
          totalSalidas={totalSalidas}
          efectivoRecibido={resumenPagos.efectivo}
          pagosDigitales={resumenPagos.digital}
          pagosPorMetodo={resumenPagos.porMetodo}
          paxTotal={paxTotal}
          boletasPendientes={boletasPendientes}
          cajaEsperada={cajaEsperada}
          diferencia={diferencia}
          cierresExistentes={cierres.data.length}
          serverError={params?.error}
          errorStep={params?.error?.includes("montos") ? 2 : params?.error?.startsWith("Completa") ? 1 : 4}
        />

        <section className="grid secondary">
          <Card label="Ingresos Vita Lima" value={money(totalIngresos)} tone="good" />
          <Card label="Propinas terapistas" value={money(resumenPropinas.total)} />
          <Card label="Dinero procesado" value={money(dineroProcesado.totalProcesado)} tone="good" />
          <Card label="Efectivo procesado" value={money(dineroProcesado.efectivoProcesado)} />
          <Card label="Digital procesado" value={money(dineroProcesado.digitalProcesado)} />
          <Card label="Salidas Vita Lima" value={money(totalSalidas)} />
          <Card label="Pax" value={numberFmt(paxTotal)} />
          <Card label="Boletas pendientes" value={numberFmt(boletasPendientes)} tone="warn" />
        </section>

        <section className="panel cierreMethodsPanel" style={{ marginBottom: "24px" }}>
          <div className="panelTitle">
            <div>
              <h2>Resumen por método de pago</h2>
              <p>Solo se muestran métodos con movimiento. El detalle separa ingresos de Vita Lima y propinas.</p>
            </div>
          </div>
          {metodosConMovimiento.length === 0 ? (
            <div className="cierreMethodsEmpty">Aún no hay movimientos registrados por método.</div>
          ) : (
            <div className="cierreMethodsList">
              {metodosConMovimiento.map((metodo) => (
                <div className="cierreMethodRow" key={metodo}>
                  <div className="cierreMethodMain">
                    <span>{metodo === "OTRO" ? "Otro" : metodo}</span>
                    <strong>{money(dineroProcesado.porMetodo[metodo])}</strong>
                  </div>
                  <small>
                    Vita Lima: {money(resumenPagos.porMetodo[metodo])}
                    {Number(resumenPropinas.porMetodo[metodo] ?? 0) > 0.009 ? ` · Propina: ${money(resumenPropinas.porMetodo[metodo])}` : ""}
                  </small>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panelTitle">
            <div>
              <h2>Cierres registrados</h2>
              <p>Últimos cierres guardados para {dateLabel(selectedFecha)} en {selectedSede}.</p>
            </div>
          </div>

          {cierres.data.length === 0 ? (
            <div className="alert" style={{ marginBottom: 0 }}>
              Todavía no hay cierres registrados para la fecha y sede seleccionadas.
            </div>
          ) : (
            <>
            <div className="tableWrap desktopData">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Sede</th>
                    <th>Ingresos Vita Lima</th>
                    <th>Propinas</th>
                    <th>Total procesado</th>
                    <th>Salidas</th>
                    <th>Caja física esperada</th>
                    <th>Diferencia física</th>
                    <th>Responsable</th>
                    <th>Estado</th>
                    <th>Cierre</th>
                  </tr>
                </thead>
                <tbody>
                  {cierres.data.map((row) => (
                    <tr key={row.cierre_id}>
                      <td>{row.fecha}</td>
                      <td>{row.sede}</td>
                      <td>{money(row.total_ingresos)}</td>
                      <td>{money(row.total_propinas)}</td>
                      <td>{money(row.total_procesado)}</td>
                      <td>{money(row.total_salidas)}</td>
                      <td>{physicalMoney(row.caja_esperada)}</td>
                      <td className="strong">{physicalMoney(row.diferencia)}</td>
                      <td>{row.responsable || "-"}</td>
                      <td>{row.estado || "-"}</td>
                      <td><details className="technicalDetails"><summary>Ver ID</summary><code>{row.cierre_id}</code></details></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobileRecordList">
              {cierres.data.map((row) => (
                <article className="mobileRecordCard" key={`mobile-${row.cierre_id}`}>
                  <div className="mobileRecordHeader">
                    <h3>{row.fecha} · {row.sede}</h3>
                    <Badge tone={String(row.estado).toUpperCase() === "CERRADO" ? "good" : "warn"}>{row.estado || "-"}</Badge>
                  </div>
                  <div className="mobileRecordMeta">
                    <div className="mobileRecordHighlight"><span>Ingresos Vita Lima</span><strong>{money(row.total_ingresos)}</strong></div>
                    <div><span>Propinas</span><strong>{money(row.total_propinas)}</strong></div>
                    <div><span>Total procesado</span><strong>{money(row.total_procesado)}</strong></div>
                    <div><span>Salidas</span><strong>{money(row.total_salidas)}</strong></div>
                    <div><span>Caja física esperada</span><strong>{physicalMoney(row.caja_esperada)}</strong></div>
                    <div><span>Diferencia física</span><strong>{physicalMoney(row.diferencia)}</strong></div>
                    <div><span>Responsable</span><strong>{row.responsable || "-"}</strong></div>
                  </div>
                  <details className="technicalDetails"><summary>Referencia interna</summary><code>{row.cierre_id}</code></details>
                </article>
              ))}
            </div>
            </>
          )}
        </section>
      </section>
    </main>
  );
}

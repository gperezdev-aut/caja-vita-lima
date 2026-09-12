import { requireModuleAccess } from "@/lib/auth";
import { CajaSidebar } from "@/components/CajaSidebar";
import { supabaseSelect, supabaseSelectAllWhere, supabaseSelectWhere } from "@/lib/supabaseServer";
import {
  METODOS_CIERRE,
  resumirMovimientosOperativos,
  resumirPagosCierre,
  sumarSalidas,
} from "@/lib/cierreCaja";
import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { FormField } from "@/components/FormField";
import { Input } from "@/components/Input";
import { Select } from "@/components/Select";
import { Textarea } from "@/components/Textarea";
import { createCierreCajaAction } from "./actions";

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

  const [config, pagos, movimientos, salidas, cierres] = await Promise.all([
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
        "select=cierre_id,fecha,sede,total_ingresos,total_salidas,caja_esperada,diferencia,responsable,estado,observacion,created_at",
        `fecha=eq.${selectedFecha}`,
        `sede=eq.${encodeURIComponent(selectedSede)}`,
        "order=created_at.desc",
      ].join("&")
    ),
  ]);

  const sedes = list(config.data, "SEDES");
  const responsables = list(config.data, "RESPONSABLES");

  const errors = [config.error, pagos.error, movimientos.error, salidas.error, cierres.error].filter(Boolean);
  const resumenPagos = resumirPagosCierre(pagos.data);
  const totalIngresos = resumenPagos.total;
  const totalSalidas = sumarSalidas(salidas.data);
  const { paxTotal, boletasPendientes } = resumirMovimientosOperativos(movimientos.data);

  return (
    <main className="appShell">
      <CajaSidebar session={session} />

      <section className="page">
        <section className="hero" style={{ minHeight: "150px" }}>
          <div>
            <p className="eyebrow">Control diario</p>
            <h1>Cierre de caja</h1>
            <p className="subtitle">
              Registra el cierre diario por sede. Los ingresos se calculan desde
              pagos realmente recibidos y las salidas desde su ledger de {dateLabel(selectedFecha)} en {selectedSede}.
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
                  href="/cierre-caja"
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

        <section className="grid secondary">
          <Card label="Ingresos" value={money(totalIngresos)} tone="good" />
          <Card label="Efectivo recibido" value={money(resumenPagos.efectivo)} tone="good" />
          <Card label="Pagos digitales" value={money(resumenPagos.digital)} />
          <Card label="Salidas" value={money(totalSalidas)} />
          <Card label="Pax" value={numberFmt(paxTotal)} />
          <Card label="Boletas pendientes" value={numberFmt(boletasPendientes)} tone="warn" />
        </section>

        <section className="panel" style={{ marginBottom: "24px" }}>
          <div className="panelTitle">
            <div>
              <h2>Ingresos por método</h2>
              <p>Desglose del ledger de pagos por fecha real de cobro.</p>
            </div>
          </div>
          <div className="miniList">
            {METODOS_CIERRE.map((metodo) => (
              <div className="miniItem" key={metodo}>
                <span>{metodo}</span>
                <strong>{money(resumenPagos.porMetodo[metodo])}</strong>
              </div>
            ))}
          </div>
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
              <FormField label="Fecha">
                <Input name="fecha" type="date" defaultValue={selectedFecha} required />
              </FormField>

              <FormField label="Sede">
                <Select name="sede" defaultValue={selectedSede} required>
                  <Options rows={sedes} fallback={["Miraflores", "San Borja"]} />
                </Select>
              </FormField>

              <FormField label="Responsable">
                <Select name="responsable" defaultValue="Gerald">
                  <Options rows={responsables} fallback={["Gerald", "Luis", "Naty", "Otro"]} />
                </Select>
              </FormField>

              <FormField label="Estado">
                <Input value="CERRADO" readOnly />
              </FormField>
            </FormGrid>
          </Section>

          <Section title="Montos">
            <FormGrid>
              <FormField label="Caja inicial">
                <Input name="caja_inicial" type="number" step="0.01" min="0" defaultValue="0.00" required />
              </FormField>

              <FormField label="Efectivo contado">
                <Input name="efectivo_contado" type="number" step="0.01" min="0" defaultValue="0.00" required />
              </FormField>

              <FormField label="Pozo / fondo">
                <Input name="pozo_fondo" type="number" step="0.01" min="0" defaultValue="0.00" required />
              </FormField>

              <FormField label="Total ingresos">
                <Input name="total_ingresos" type="number" step="0.01" min="0" value={totalIngresos.toFixed(2)} readOnly />
              </FormField>

              <FormField label="Total salidas">
                <Input name="total_salidas" type="number" step="0.01" min="0" value={totalSalidas.toFixed(2)} readOnly />
              </FormField>

              <FormField label="Pax total">
                <Input name="pax_total" type="number" min="0" value={String(paxTotal)} readOnly />
              </FormField>

              <FormField label="Boletas pendientes">
                <Input name="boletas_pendientes" type="number" min="0" value={String(boletasPendientes)} readOnly />
              </FormField>
            </FormGrid>
            <p className="subtitle" style={{ marginTop: "16px" }}>
              La tabla actual no indica si una salida fue en efectivo o digital. Por eso
              el saldo esperado guardado sigue siendo operativo y no debe interpretarse
              como caja física hasta definir y registrar el método de cada salida.
            </p>
          </Section>

          <Section title="Observación">
            <FormField label="Nota interna">
              <Textarea
                name="observacion"
                placeholder="Ej. Cierre de prueba, faltó efectivo, boleta pendiente, diferencia explicada, etc."
                rows={4}
                style={{ minHeight: "110px" }}
              />
            </FormField>
          </Section>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", flexWrap: "wrap" }}>
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
              }}
            >
              Volver al dashboard
            </Link>

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
              Guardar cierre
            </SubmitButton>
          </div>
        </form>

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
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Sede</th>
                    <th>Ingresos</th>
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
                      <td>{money(row.total_salidas)}</td>
                      <td>{physicalMoney(row.caja_esperada)}</td>
                      <td className="strong">{physicalMoney(row.diferencia)}</td>
                      <td>{row.responsable || "-"}</td>
                      <td>{row.estado || "-"}</td>
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

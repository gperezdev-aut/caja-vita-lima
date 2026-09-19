import { requireModuleAccess } from "@/lib/auth";
import { CajaSidebar } from "@/components/CajaSidebar";
import { supabaseSelect, supabaseSelectWhere } from "@/lib/supabaseServer";
import { FormField } from "@/components/FormField";
import { Input } from "@/components/Input";
import { Select } from "@/components/Select";
import {
  NATURALEZA_SALIDA_LABELS,
  type NaturalezaSalida,
} from "@/lib/salidasCaja";
import { clasificarSalidaFinanciera } from "@/lib/cierreCaja";
import { createSalidaAction } from "./actions";
import { RegistrarSalidaWizard } from "./RegistrarSalidaWizard.tsx";

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

function values(rows: Row[], fallback: string[]) {
  return rows.length ? rows.map((row) => String(row.valor)) : fallback;
}

function FormGrid({ children }: { children: React.ReactNode }) {
  return <div className="formGrid">{children}</div>;
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

function naturalezaLabel(value: string) {
  return (
    NATURALEZA_SALIDA_LABELS[value as NaturalezaSalida] ??
    value.replaceAll("_", " ")
  );
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

  const salidaQuery = [
    "select=salida_id,fecha,hora,sede,tipo_gasto,concepto,monto,metodo_salida,categoria_financiera,responsable,observacion,created_at",
    `fecha=eq.${selectedFecha}`,
    "order=created_at.desc",
  ];

  const fondosQuery = [
    "select=movimiento_fondo_id,fecha,hora,sede,tipo_movimiento,metodo,concepto,monto,responsable,observacion,created_at",
    `fecha=eq.${selectedFecha}`,
    "order=created_at.desc",
  ];

  if (selectedSede !== "TODAS") {
    const filtroSede = `sede=eq.${encodeURIComponent(selectedSede)}`;
    salidaQuery.splice(2, 0, filtroSede);
    fondosQuery.splice(2, 0, filtroSede);
  }

  const [config, salidas, movimientosFondos] = await Promise.all([
    supabaseSelect<Row>("config_listas"),
    supabaseSelectWhere<Row>("caja_salidas", salidaQuery.join("&")),
    supabaseSelectWhere<Row>("caja_movimientos_fondos", fondosQuery.join("&")),
  ]);

  const sedes = list(config.data, "SEDES");
  const responsables = list(config.data, "RESPONSABLES");
  const tiposGasto = list(config.data, "TIPOS_GASTO");
  const sedeValues = values(sedes, ["Miraflores", "San Borja"]);
  const responsableValues = values(responsables, ["Gerald", "Luis", "Naty", "Otro"]);
  const tipoGastoValues = values(tiposGasto, [
    "Movilidad",
    "Insumos",
    "Limpieza",
    "Alquiler",
    "Servicios",
    "Apoyo Therapy",
    "Otro",
  ]);

  const totalGastos = salidas.data.reduce(
    (sum, row) =>
      sum +
      (clasificarSalidaFinanciera(row) === "GASTO_OPERATIVO"
        ? Number(row.monto ?? 0)
        : 0),
    0
  );

  const totalMovimientosFondos = movimientosFondos.data.reduce(
    (sum, row) => sum + Number(row.monto ?? 0),
    0
  );

  const registros = [
    ...salidas.data.map((row) => ({
      id: row.salida_id,
      fecha: row.fecha,
      hora: row.hora,
      sede: row.sede,
      naturaleza:
        clasificarSalidaFinanciera(row) === "GASTO_OPERATIVO"
          ? "GASTO"
          : clasificarSalidaFinanciera(row),
      categoria: row.tipo_gasto,
      metodo: row.metodo_salida,
      concepto: row.concepto,
      monto: row.monto,
      responsable: row.responsable,
      observacion: row.observacion,
      created_at: row.created_at,
    })),
    ...movimientosFondos.data.map((row) => ({
      id: row.movimiento_fondo_id,
      fecha: row.fecha,
      hora: row.hora,
      sede: row.sede,
      naturaleza: row.tipo_movimiento,
      categoria: null,
      metodo: row.metodo,
      concepto: row.concepto,
      monto: row.monto,
      responsable: row.responsable,
      observacion: row.observacion,
      created_at: row.created_at,
    })),
  ].sort((a, b) =>
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
  );

  const errors = [config.error, salidas.error, movimientosFondos.error].filter(Boolean);
  const sedeLabel = selectedSede === "TODAS" ? "todas las sedes" : selectedSede;

  return (
    <main className="appShell">
      <CajaSidebar session={session} />

      <section className="page registrarSalidaPage">
        <section className="hero" style={{ minHeight: "150px" }}>
          <div>
            <p className="eyebrow">Operación</p>
            <h1>Registrar salida</h1>
            <p className="subtitle">
              Registra gastos reales y movimientos de fondos sin mezclarlos.
              La lista inferior muestra movimientos de {dateLabel(selectedFecha)} en {sedeLabel}.
            </p>
          </div>

          <div className="badge">
            <span>Gastos Vita Lima</span>
            <strong>{money(totalGastos)}</strong>
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
            Movimiento guardado correctamente. ID: <strong>{params.id}</strong>
          </div>
        )}

        {errors.length > 0 && (
          <div className="alert">
            <strong>Revisar conexión o migración 042:</strong>
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
              <p>Consulta gastos y movimientos de fondos por fecha y sede.</p>
            </div>
          </div>

          <form method="get" action="/registrar-salida">
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
                <Select name="sede" defaultValue={selectedSede}>
                  <option value="TODAS">Todas las sedes</option>
                  <Options rows={sedes} fallback={["Miraflores", "San Borja"]} />
                </Select>
              </FormField>

              <div className="filterActions operationalFilterActions">
                <button className="primaryButton" type="submit">
                  Aplicar filtros
                </button>

                <a className="ghostButton" href="/registrar-salida">
                  Ver hoy
                </a>
              </div>
            </FormGrid>
          </form>
        </section>

        <RegistrarSalidaWizard
          action={createSalidaAction}
          sedes={sedeValues}
          tiposGasto={tipoGastoValues}
          responsables={responsableValues}
          defaultDate={selectedFecha}
          defaultTime={nowInLima()}
          defaultSede={selectedSede === "TODAS" ? sedeValues[0] ?? "Miraflores" : selectedSede}
          serverError={params?.error}
          errorStep={params?.error?.includes("monto") ? 2 : params?.error?.startsWith("Completa") ? 1 : 3}
        />

        <section className="grid secondary">
          <div className="card good">
            <span>Gastos del negocio</span>
            <strong>{money(totalGastos)}</strong>
          </div>
          <div className="card">
            <span>Movimientos de fondos</span>
            <strong>{money(totalMovimientosFondos)}</strong>
          </div>
        </section>

        <section className="panel">
          <div className="panelTitle">
            <div>
              <h2>Movimientos registrados</h2>
              <p>
                Gastos afectan resultados; movimientos de fondos solo cambian custodia o caja física.
              </p>
            </div>
          </div>

          {registros.length === 0 ? (
            <div className="alert" style={{ marginBottom: 0 }}>
              No hay movimientos registrados para la fecha y sede seleccionadas.
            </div>
          ) : (
            <>
              <div className="tableWrap desktopData">
                <table>
                  <thead>
                    <tr>
                      <th>Hora</th>
                      <th>Sede</th>
                      <th>Naturaleza</th>
                      <th>Categoría</th>
                      <th>Método</th>
                      <th>Concepto</th>
                      <th>Monto</th>
                      <th>Responsable</th>
                      <th>Observación</th>
                      <th>ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {registros.map((row) => (
                      <tr key={row.id}>
                        <td>{String(row.hora ?? "-").slice(0, 5)}</td>
                        <td>{row.sede}</td>
                        <td>{naturalezaLabel(String(row.naturaleza))}</td>
                        <td>{row.categoria || "—"}</td>
                        <td>{row.metodo || "Sin clasificar"}</td>
                        <td className="strong">{row.concepto}</td>
                        <td>{money(row.monto)}</td>
                        <td>{row.responsable || "-"}</td>
                        <td>{row.observacion || "-"}</td>
                        <td><details className="technicalDetails"><summary>Ver ID</summary><code>{row.id}</code></details></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mobileRecordList">
                {registros.map((row) => (
                  <article className="mobileRecordCard" key={`mobile-${row.id}`}>
                    <div className="mobileRecordHeader">
                      <h3>{row.concepto}</h3>
                      <strong>{money(row.monto)}</strong>
                    </div>
                    <div className="mobileRecordMeta">
                      <div><span>Hora</span><strong>{String(row.hora ?? "-").slice(0, 5)}</strong></div>
                      <div><span>Sede</span><strong>{row.sede}</strong></div>
                      <div><span>Naturaleza</span><strong>{naturalezaLabel(String(row.naturaleza))}</strong></div>
                      {row.categoria && <div><span>Categoría</span><strong>{row.categoria}</strong></div>}
                      <div><span>Método</span><strong>{row.metodo || "Sin clasificar"}</strong></div>
                      <div><span>Responsable</span><strong>{row.responsable || "-"}</strong></div>
                      {row.observacion && <div><span>Observación</span><strong>{row.observacion}</strong></div>}
                    </div>
                    <details className="technicalDetails"><summary>Referencia interna</summary><code>{row.id}</code></details>
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

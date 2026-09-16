import Link from "next/link";
import { CajaSidebar } from "@/components/CajaSidebar";
import { requireModuleAccess } from "@/lib/auth";
import { supabaseSelectWhere } from "@/lib/supabaseServer";
import { deleteHorarioExcepcionAction, saveHorarioExcepcionAction } from "./actions";

type TerapistaRow = {
  terapista_id: string;
  nombre: string;
  estado: "ACTIVA" | "INACTIVA";
};

type HorarioRow = {
  terapista_id: string;
  dia_semana: number;
  trabaja: boolean;
  hora_inicio: string | null;
  hora_fin: string | null;
  sede: string | null;
};

type ExcepcionRow = {
  excepcion_id: number;
  terapista_id: string;
  fecha: string;
  tipo: string;
  trabaja: boolean;
  hora_inicio: string | null;
  hora_fin: string | null;
  sede: string | null;
  observacion: string | null;
};

const DIAS = [
  [1, "Lun"],
  [2, "Mar"],
  [3, "Mié"],
  [4, "Jue"],
  [5, "Vie"],
  [6, "Sáb"],
  [7, "Dom"],
] as const;

const TIPO_LABEL: Record<string, string> = {
  DESCANSO: "Descanso",
  CAMBIO_HORARIO: "Cambio horario",
  FALTA: "Falta",
  RECUPERACION: "Recuperación",
  VACACIONES: "Vacaciones",
  REUNION: "Reunión",
  APOYO: "Apoyo",
};

function hhmm(value: string | null) {
  return value ? value.slice(0, 5) : "";
}

function limaYearMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "2026";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  return `${year}-${month}`;
}

function normalizeMonth(value: string | undefined) {
  return /^\d{4}-\d{2}$/.test(value ?? "") ? value! : limaYearMonth();
}

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const last = new Date(Date.UTC(year, monthNumber, 0));
  return {
    first: first.toISOString().slice(0, 10),
    last: last.toISOString().slice(0, 10),
    days: Array.from({ length: last.getUTCDate() }, (_, index) => {
      const date = new Date(Date.UTC(year, monthNumber - 1, index + 1));
      const jsDay = date.getUTCDay();
      return {
        iso: date.toISOString().slice(0, 10),
        day: index + 1,
        weekDay: jsDay === 0 ? 7 : jsDay,
      };
    }),
  };
}

function moveMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("es-PE", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function scheduleLabel(row: HorarioRow | ExcepcionRow | undefined) {
  if (!row || !row.trabaja) return "Descanso";
  const range = `${hhmm(row.hora_inicio)}–${hhmm(row.hora_fin)}`;
  return row.sede ? `${range} · ${row.sede}` : range;
}

function errorMessage(code: string | undefined) {
  if (!code) return "";
  if (code === "sin_permisos") return "Solo Administración puede modificar horarios.";
  if (code === "horas") return "La hora de salida debe ser posterior a la hora de entrada.";
  if (code === "datos") return "Completa terapista, fecha y tipo de excepción.";
  return "No se pudo guardar el cambio de horario.";
}

export default async function HorariosPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; updated?: string; deleted?: string; error?: string }>;
}) {
  const session = await requireModuleAccess("horarios");
  const query = await searchParams;
  const month = normalizeMonth(query.mes);
  const bounds = monthBounds(month);
  const canEdit = session.rol === "ADMIN_GERALD" || session.rol === "SOCIO";

  const [terapistasResult, horariosResult, excepcionesResult] = await Promise.all([
    supabaseSelectWhere<TerapistaRow>(
      "terapistas",
      "select=terapista_id,nombre,estado&estado=eq.ACTIVA&order=nombre.asc"
    ),
    supabaseSelectWhere<HorarioRow>(
      "terapista_horario_habitual",
      "select=terapista_id,dia_semana,trabaja,hora_inicio,hora_fin,sede&order=terapista_id.asc,dia_semana.asc"
    ),
    supabaseSelectWhere<ExcepcionRow>(
      "terapista_horario_excepciones",
      `select=excepcion_id,terapista_id,fecha,tipo,trabaja,hora_inicio,hora_fin,sede,observacion&fecha=gte.${bounds.first}&fecha=lte.${bounds.last}&order=fecha.asc,terapista_id.asc`
    ),
  ]);

  const habitualByTherapist = new Map<string, Map<number, HorarioRow>>();
  for (const row of horariosResult.data) {
    if (!habitualByTherapist.has(row.terapista_id)) {
      habitualByTherapist.set(row.terapista_id, new Map());
    }
    habitualByTherapist.get(row.terapista_id)!.set(row.dia_semana, row);
  }

  const excepcionByTherapist = new Map<string, Map<string, ExcepcionRow>>();
  for (const row of excepcionesResult.data) {
    if (!excepcionByTherapist.has(row.terapista_id)) {
      excepcionByTherapist.set(row.terapista_id, new Map());
    }
    excepcionByTherapist.get(row.terapista_id)!.set(row.fecha, row);
  }

  const therapistName = new Map(terapistasResult.data.map((row) => [row.terapista_id, row.nombre]));
  const errors = [terapistasResult.error, horariosResult.error, excepcionesResult.error].filter(Boolean);

  return (
    <main className="appShell">
      <CajaSidebar session={session} />
      <section className="page">
        <section className="hero" style={{ minHeight: "145px" }}>
          <div>
            <p className="eyebrow">Personal</p>
            <h1>Horarios</h1>
            <p className="subtitle">
              Cuadro global de entrada, salida y descansos. El horario habitual viene de cada ficha y los cambios puntuales se aplican por fecha.
            </p>
          </div>
          <div className="badge"><span>Activas</span><strong>{terapistasResult.data.length}</strong></div>
        </section>

        {query.updated === "1" && <div className="formMessage ok">Excepción guardada correctamente.</div>}
        {query.deleted === "1" && <div className="formMessage ok">Excepción eliminada; vuelve a aplicar el horario habitual.</div>}
        {query.error && <div className="formMessage error">{errorMessage(query.error)}</div>}
        {errors.length > 0 && <div className="alert">No se pudo cargar toda la información de horarios.</div>}

        <section className="panel">
          <div className="panelTitle" style={{ alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <h2 style={{ textTransform: "capitalize" }}>{monthLabel(month)}</h2>
              <p>Desliza horizontalmente en celular para recorrer el mes.</p>
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <Link className="ghostButton" href={`/horarios?mes=${moveMonth(month, -1)}`}>← Mes anterior</Link>
              <Link className="ghostButton" href={`/horarios?mes=${limaYearMonth()}`}>Hoy</Link>
              <Link className="ghostButton" href={`/horarios?mes=${moveMonth(month, 1)}`}>Mes siguiente →</Link>
            </div>
          </div>

          <div className="tableWrap">
            <table className="horarioMensualTable" style={{ minWidth: `${Math.max(980, 170 + bounds.days.length * 132)}px` }}>
              <thead>
                <tr>
                  <th className="horarioStickyCol">Terapista</th>
                  {bounds.days.map((day) => (
                    <th key={day.iso}>
                      <span>{DIAS.find(([value]) => value === day.weekDay)?.[1]}</span>
                      <strong style={{ display: "block", marginTop: "3px" }}>{day.day}</strong>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {terapistasResult.data.map((terapista) => {
                  const habitual = habitualByTherapist.get(terapista.terapista_id);
                  const excepciones = excepcionByTherapist.get(terapista.terapista_id);
                  return (
                    <tr key={terapista.terapista_id}>
                      <td className="horarioStickyCol">
                        <Link className="strong" href={`/terapistas/${terapista.terapista_id}/horario`}>
                          {terapista.nombre}
                        </Link>
                      </td>
                      {bounds.days.map((day) => {
                        const exception = excepciones?.get(day.iso);
                        const base = habitual?.get(day.weekDay);
                        const resolved = exception ?? base;
                        return (
                          <td key={day.iso} className={exception ? "horarioExceptionCell" : undefined}>
                            <strong style={{ display: "block", fontSize: "12px" }}>{scheduleLabel(resolved)}</strong>
                            {exception && (
                              <small style={{ display: "block", marginTop: "5px", fontWeight: 800 }}>
                                {TIPO_LABEL[exception.tipo] ?? exception.tipo}
                              </small>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {canEdit && (
          <section className="panel">
            <div className="panelTitle">
              <div>
                <h2>Cambio puntual por fecha</h2>
                <p>Úsalo para descanso, falta, recuperación, vacaciones, reunión, apoyo o cambio de horario. No modifica el patrón habitual.</p>
              </div>
            </div>

            <form action={saveHorarioExcepcionAction} className="atencionForm" style={{ boxShadow: "none" }}>
              <div className="atencionGrid">
                <label className="atencionField">
                  Terapista
                  <select name="terapista_id" required defaultValue="">
                    <option value="" disabled>Seleccionar</option>
                    {terapistasResult.data.map((terapista) => (
                      <option key={terapista.terapista_id} value={terapista.terapista_id}>{terapista.nombre}</option>
                    ))}
                  </select>
                </label>
                <label className="atencionField">
                  Fecha
                  <input name="fecha" type="date" min={bounds.first} max={bounds.last} required />
                </label>
                <label className="atencionField">
                  Tipo
                  <select name="tipo" required defaultValue="DESCANSO">
                    <option value="DESCANSO">Descanso</option>
                    <option value="CAMBIO_HORARIO">Cambio de horario</option>
                    <option value="FALTA">Falta</option>
                    <option value="RECUPERACION">Recuperación</option>
                    <option value="VACACIONES">Vacaciones</option>
                    <option value="REUNION">Reunión</option>
                    <option value="APOYO">Apoyo</option>
                  </select>
                </label>
                <label className="atencionField">
                  Entrada
                  <input name="hora_inicio" type="time" />
                  <small>Solo se usa en cambio de horario, recuperación o apoyo.</small>
                </label>
                <label className="atencionField">
                  Salida
                  <input name="hora_fin" type="time" />
                </label>
                <label className="atencionField">
                  Sede
                  <select name="sede" defaultValue="">
                    <option value="">Sin definir</option>
                    <option value="Miraflores">Miraflores</option>
                    <option value="San Borja">San Borja</option>
                    <option value="Ambas">Ambas</option>
                  </select>
                </label>
                <label className="atencionField atencionFieldWide">
                  Observación
                  <input name="observacion" placeholder="Ej. cambio solicitado por coordinación" />
                </label>
              </div>
              <button className="primaryButton" type="submit" style={{ width: "100%", marginTop: "16px" }}>
                Guardar cambio puntual
              </button>
            </form>
          </section>
        )}

        <section className="panel">
          <div className="panelTitle"><div><h2>Excepciones del mes</h2><p>Los cambios aquí reemplazan el horario habitual solo en esa fecha.</p></div></div>
          <div className="miniList">
            {excepcionesResult.data.length === 0 ? (
              <div className="miniItem"><span>Sin excepciones registradas este mes</span></div>
            ) : excepcionesResult.data.map((row) => (
              <div className="miniItem" key={row.excepcion_id} style={{ alignItems: "center", flexWrap: "wrap" }}>
                <span>
                  <strong style={{ display: "block", color: "var(--text)" }}>{therapistName.get(row.terapista_id) ?? "Terapista"} · {row.fecha}</strong>
                  {TIPO_LABEL[row.tipo] ?? row.tipo} · {scheduleLabel(row)}{row.observacion ? ` · ${row.observacion}` : ""}
                </span>
                {canEdit && (
                  <form action={deleteHorarioExcepcionAction}>
                    <input type="hidden" name="terapista_id" value={row.terapista_id} />
                    <input type="hidden" name="fecha" value={row.fecha} />
                    <button className="ghostButton" type="submit">Quitar excepción</button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panelTitle"><div><h2>Horario habitual</h2><p>Referencia base semanal de cada terapista.</p></div></div>
          <div className="tableWrap">
            <table style={{ minWidth: "1080px" }}>
              <thead>
                <tr>
                  <th>Terapista</th>
                  {DIAS.map(([, nombre]) => <th key={nombre}>{nombre}</th>)}
                </tr>
              </thead>
              <tbody>
                {terapistasResult.data.map((terapista) => {
                  const schedule = habitualByTherapist.get(terapista.terapista_id);
                  return (
                    <tr key={terapista.terapista_id}>
                      <td><Link className="strong" href={`/terapistas/${terapista.terapista_id}/horario`}>{terapista.nombre}</Link></td>
                      {DIAS.map(([dia, nombre]) => <td key={nombre}>{scheduleLabel(schedule?.get(dia))}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

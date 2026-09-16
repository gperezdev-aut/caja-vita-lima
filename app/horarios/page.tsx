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

type CalendarDay = {
  iso: string;
  day: number;
  weekDay: number;
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

const TYPE_STYLE: Record<string, { background: string; color: string; borderColor: string }> = {
  DESCANSO: { background: "#eee9e1", color: "#4f5960", borderColor: "#d7d0c5" },
  CAMBIO_HORARIO: { background: "#fff1c9", color: "#795500", borderColor: "#ecd28b" },
  FALTA: { background: "#fde4df", color: "#9b3126", borderColor: "#edb9b0" },
  RECUPERACION: { background: "#ffe6cf", color: "#8a4708", borderColor: "#f0bf91" },
  VACACIONES: { background: "#dff3f5", color: "#17616a", borderColor: "#acd9de" },
  REUNION: { background: "#ece4f8", color: "#5d3c85", borderColor: "#cfbce7" },
  APOYO: { background: "#e1edf9", color: "#295e8a", borderColor: "#b5d0e8" },
};

function hhmm(value: string | null) {
  return value ? value.slice(0, 5) : "";
}

function limaTodayIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "2026";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function limaYearMonth() {
  return limaTodayIso().slice(0, 7);
}

function normalizeMonth(value: string | undefined) {
  return /^\d{4}-\d{2}$/.test(value ?? "") ? value! : limaYearMonth();
}

function normalizeDate(value: string | undefined) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value! : limaTodayIso();
}

function utcDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function isoFromDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(iso: string, delta: number) {
  const date = utcDate(iso);
  date.setUTCDate(date.getUTCDate() + delta);
  return isoFromDate(date);
}

function weekBounds(anchorIso: string) {
  const anchor = utcDate(anchorIso);
  const jsDay = anchor.getUTCDay();
  const mondayDelta = jsDay === 0 ? -6 : 1 - jsDay;
  const monday = new Date(anchor);
  monday.setUTCDate(anchor.getUTCDate() + mondayDelta);
  const days: CalendarDay[] = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + index);
    return {
      iso: isoFromDate(date),
      day: date.getUTCDate(),
      weekDay: index + 1,
    };
  });
  return { first: days[0].iso, last: days[6].iso, days };
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
      } satisfies CalendarDay;
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

function compactDateLabel(iso: string) {
  return new Intl.DateTimeFormat("es-PE", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(utcDate(iso));
}

function weekLabel(first: string, last: string) {
  return `${compactDateLabel(first)} → ${compactDateLabel(last)}`;
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
  searchParams: Promise<{
    vista?: string;
    fecha?: string;
    mes?: string;
    updated?: string;
    deleted?: string;
    error?: string;
  }>;
}) {
  const session = await requireModuleAccess("horarios");
  const query = await searchParams;
  const view = query.vista === "mes" ? "mes" : "semana";
  const anchorDate = normalizeDate(query.fecha);
  const month = normalizeMonth(query.mes ?? anchorDate.slice(0, 7));
  const bounds = view === "semana" ? weekBounds(anchorDate) : monthBounds(month);
  const today = limaTodayIso();
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

  const weekPrev = addDays(bounds.first, -7);
  const weekNext = addDays(bounds.first, 7);
  const calendarTitle = view === "semana" ? `Semana ${weekLabel(bounds.first, bounds.last)}` : monthLabel(month);

  return (
    <main className="appShell">
      <CajaSidebar session={session} />
      <section className="page">
        <section className="hero" style={{ minHeight: "145px" }}>
          <div>
            <p className="eyebrow">Personal</p>
            <h1>Horarios</h1>
            <p className="subtitle">
              Vista rápida de entradas, salidas y descansos. Semana para operación diaria; mes para planificación.
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
              <h2 style={{ textTransform: "capitalize" }}>{calendarTitle}</h2>
              <p>{view === "semana" ? "La semana actual se muestra por defecto." : "Desliza horizontalmente para recorrer el mes."}</p>
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
              <Link className={view === "semana" ? "primaryButton" : "ghostButton"} href={`/horarios?vista=semana&fecha=${anchorDate}`}>Semana</Link>
              <Link className={view === "mes" ? "primaryButton" : "ghostButton"} href={`/horarios?vista=mes&mes=${month}`}>Mes</Link>
              {view === "semana" ? (
                <>
                  <Link className="ghostButton" href={`/horarios?vista=semana&fecha=${weekPrev}`}>← Semana anterior</Link>
                  <Link className="ghostButton" href={`/horarios?vista=semana&fecha=${today}`}>Esta semana</Link>
                  <Link className="ghostButton" href={`/horarios?vista=semana&fecha=${weekNext}`}>Semana siguiente →</Link>
                </>
              ) : (
                <>
                  <Link className="ghostButton" href={`/horarios?vista=mes&mes=${moveMonth(month, -1)}`}>← Mes anterior</Link>
                  <Link className="ghostButton" href={`/horarios?vista=mes&mes=${limaYearMonth()}`}>Hoy</Link>
                  <Link className="ghostButton" href={`/horarios?vista=mes&mes=${moveMonth(month, 1)}`}>Mes siguiente →</Link>
                </>
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "14px" }}>
            {Object.entries(TIPO_LABEL).map(([tipo, label]) => (
              <span
                key={tipo}
                style={{
                  ...TYPE_STYLE[tipo],
                  border: `1px solid ${TYPE_STYLE[tipo].borderColor}`,
                  borderRadius: "999px",
                  padding: "6px 10px",
                  fontSize: "12px",
                  fontWeight: 800,
                }}
              >
                {label}
              </span>
            ))}
          </div>

          <div className="tableWrap">
            <table style={{ minWidth: view === "semana" ? "920px" : `${Math.max(980, 170 + bounds.days.length * 132)}px` }}>
              <thead>
                <tr>
                  <th style={{ position: "sticky", left: 0, zIndex: 4, background: "#fbf4e7", minWidth: "150px" }}>Terapista</th>
                  {bounds.days.map((day) => {
                    const isToday = day.iso === today;
                    return (
                      <th
                        key={day.iso}
                        style={isToday ? { background: "#e5f1eb", color: "#1f6b4f" } : undefined}
                      >
                        <span>{DIAS.find(([value]) => value === day.weekDay)?.[1]}</span>
                        <strong style={{ display: "block", marginTop: "3px" }}>{day.day}</strong>
                        {isToday && <small style={{ display: "block", marginTop: "3px", fontWeight: 900 }}>HOY</small>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {terapistasResult.data.map((terapista) => {
                  const habitual = habitualByTherapist.get(terapista.terapista_id);
                  const excepciones = excepcionByTherapist.get(terapista.terapista_id);
                  return (
                    <tr key={terapista.terapista_id}>
                      <td style={{ position: "sticky", left: 0, zIndex: 3, background: "white", minWidth: "150px" }}>
                        <Link className="strong" href={`/terapistas/${terapista.terapista_id}/horario`}>
                          {terapista.nombre}
                        </Link>
                      </td>
                      {bounds.days.map((day) => {
                        const exception = excepciones?.get(day.iso);
                        const base = habitual?.get(day.weekDay);
                        const resolved = exception ?? base;
                        const isToday = day.iso === today;
                        const style = exception ? TYPE_STYLE[exception.tipo] : undefined;
                        return (
                          <td
                            key={day.iso}
                            style={{
                              ...(style ?? {}),
                              ...(isToday ? { boxShadow: "inset 0 0 0 2px rgba(31,107,79,.32)" } : {}),
                              minWidth: view === "semana" ? "108px" : "124px",
                            }}
                          >
                            {exception ? (
                              <>
                                <strong style={{ display: "block", fontSize: "12px" }}>
                                  {exception.tipo === "DESCANSO" ? "DESCANSO" : TIPO_LABEL[exception.tipo] ?? exception.tipo}
                                </strong>
                                {exception.trabaja && (
                                  <small style={{ display: "block", marginTop: "5px", fontWeight: 800 }}>
                                    {scheduleLabel(exception)}
                                  </small>
                                )}
                              </>
                            ) : (
                              <strong style={{ display: "block", fontSize: "12px" }}>{scheduleLabel(resolved)}</strong>
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
                  <input name="fecha" type="date" required />
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
          <div className="panelTitle"><div><h2>Excepciones visibles</h2><p>Cambios puntuales dentro del período mostrado.</p></div></div>
          <div className="miniList">
            {excepcionesResult.data.length === 0 ? (
              <div className="miniItem"><span>Sin excepciones registradas en este período</span></div>
            ) : excepcionesResult.data.map((row) => (
              <div className="miniItem" key={row.excepcion_id} style={{ alignItems: "center", flexWrap: "wrap" }}>
                <span>
                  <strong style={{ display: "block", color: "var(--text)" }}>{therapistName.get(row.terapista_id) ?? "Terapista"} · {row.fecha}</strong>
                  {row.tipo === "DESCANSO"
                    ? "Descanso"
                    : `${TIPO_LABEL[row.tipo] ?? row.tipo} · ${scheduleLabel(row)}`}
                  {row.observacion ? ` · ${row.observacion}` : ""}
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
            <table style={{ minWidth: "920px" }}>
              <thead>
                <tr>
                  <th style={{ position: "sticky", left: 0, zIndex: 4, background: "#fbf4e7" }}>Terapista</th>
                  {DIAS.map(([, nombre]) => <th key={nombre}>{nombre}</th>)}
                </tr>
              </thead>
              <tbody>
                {terapistasResult.data.map((terapista) => {
                  const schedule = habitualByTherapist.get(terapista.terapista_id);
                  return (
                    <tr key={terapista.terapista_id}>
                      <td style={{ position: "sticky", left: 0, zIndex: 3, background: "white" }}><Link className="strong" href={`/terapistas/${terapista.terapista_id}/horario`}>{terapista.nombre}</Link></td>
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

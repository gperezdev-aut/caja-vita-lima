import Link from "next/link";
import { CajaSidebar } from "@/components/CajaSidebar";
import { requireModuleAccess } from "@/lib/auth";
import { supabaseSelectWhere } from "@/lib/supabaseServer";

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

const DIAS = [
  [1, "Lun"],
  [2, "Mar"],
  [3, "Mié"],
  [4, "Jue"],
  [5, "Vie"],
  [6, "Sáb"],
  [7, "Dom"],
] as const;

function hhmm(value: string | null) {
  return value ? value.slice(0, 5) : "";
}

function scheduleLabel(row: HorarioRow | undefined) {
  if (!row || !row.trabaja) return "Descanso";
  const range = `${hhmm(row.hora_inicio)}–${hhmm(row.hora_fin)}`;
  return row.sede ? `${range} · ${row.sede}` : range;
}

export default async function HorariosPage() {
  const session = await requireModuleAccess("horarios");

  const [terapistasResult, horariosResult] = await Promise.all([
    supabaseSelectWhere<TerapistaRow>(
      "terapistas",
      "select=terapista_id,nombre,estado&estado=eq.ACTIVA&order=nombre.asc"
    ),
    supabaseSelectWhere<HorarioRow>(
      "terapista_horario_habitual",
      "select=terapista_id,dia_semana,trabaja,hora_inicio,hora_fin,sede&order=terapista_id.asc,dia_semana.asc"
    ),
  ]);

  const byTherapist = new Map<string, Map<number, HorarioRow>>();
  for (const row of horariosResult.data) {
    if (!byTherapist.has(row.terapista_id)) byTherapist.set(row.terapista_id, new Map());
    byTherapist.get(row.terapista_id)!.set(row.dia_semana, row);
  }

  const errors = [terapistasResult.error, horariosResult.error].filter(Boolean);

  return (
    <main className="appShell">
      <CajaSidebar session={session} />
      <section className="page">
        <section className="hero" style={{ minHeight: "145px" }}>
          <div>
            <p className="eyebrow">Personal</p>
            <h1>Horarios</h1>
            <p className="subtitle">
              Vista semanal general para saber a qué hora entra cada terapista. Se alimenta automáticamente desde el horario habitual de cada ficha.
            </p>
          </div>
          <div className="badge"><span>Activas</span><strong>{terapistasResult.data.length}</strong></div>
        </section>

        {errors.length > 0 && <div className="alert">No se pudo cargar toda la información de horarios.</div>}

        <section className="panel">
          <div className="panelTitle">
            <div>
              <h2>Semana habitual</h2>
              <p>En celular puedes deslizar la tabla horizontalmente. Los cambios por fecha se agregarán como excepciones en la siguiente fase.</p>
            </div>
          </div>

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
                  const schedule = byTherapist.get(terapista.terapista_id);
                  return (
                    <tr key={terapista.terapista_id}>
                      <td>
                        <Link className="strong" href={`/terapistas/${terapista.terapista_id}/horario`}>
                          {terapista.nombre}
                        </Link>
                      </td>
                      {DIAS.map(([dia, nombre]) => (
                        <td key={nombre}>{scheduleLabel(schedule?.get(dia))}</td>
                      ))}
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

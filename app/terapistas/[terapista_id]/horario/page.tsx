import Link from "next/link";
import { notFound } from "next/navigation";
import { CajaSidebar } from "@/components/CajaSidebar";
import { requireModuleAccess } from "@/lib/auth";
import { supabaseSelectWhere } from "@/lib/supabaseServer";
import { updateHorarioHabitualAction } from "./actions";

type TerapistaRow = {
  terapista_id: string;
  nombre: string;
  estado: "ACTIVA" | "INACTIVA";
};

type HorarioRow = {
  dia_semana: number;
  trabaja: boolean;
  hora_inicio: string | null;
  hora_fin: string | null;
  sede: string | null;
  observacion: string | null;
};

const DIAS = [
  [1, "Lunes"],
  [2, "Martes"],
  [3, "Miércoles"],
  [4, "Jueves"],
  [5, "Viernes"],
  [6, "Sábado"],
  [7, "Domingo"],
] as const;

function hhmm(value: string | null) {
  return value ? value.slice(0, 5) : "";
}

export default async function TerapistaHorarioPage({
  params,
  searchParams,
}: {
  params: Promise<{ terapista_id: string }>;
  searchParams: Promise<{ updated?: string; error?: string }>;
}) {
  const session = await requireModuleAccess("terapistas");
  const terapistaId = (await params).terapista_id;
  const query = await searchParams;
  const canEdit = session.rol === "ADMIN_GERALD" || session.rol === "SOCIO";

  const [terapistaResult, horarioResult] = await Promise.all([
    supabaseSelectWhere<TerapistaRow>(
      "terapistas",
      `select=terapista_id,nombre,estado&terapista_id=eq.${encodeURIComponent(terapistaId)}&limit=1`
    ),
    supabaseSelectWhere<HorarioRow>(
      "terapista_horario_habitual",
      `select=dia_semana,trabaja,hora_inicio,hora_fin,sede,observacion&terapista_id=eq.${encodeURIComponent(terapistaId)}&order=dia_semana.asc`
    ),
  ]);

  const terapista = terapistaResult.data[0];
  if (!terapista) notFound();

  const byDay = new Map(horarioResult.data.map((row) => [row.dia_semana, row]));

  return (
    <main className="appShell">
      <CajaSidebar session={session} />
      <section className="page">
        <section className="hero" style={{ minHeight: "145px" }}>
          <div>
            <p className="eyebrow">Horario habitual</p>
            <h1>{terapista.nombre}</h1>
            <p className="subtitle">Configura el patrón semanal base. Los cambios puntuales por fecha se manejarán después como excepciones.</p>
          </div>
          <div className="badge"><span>Estado</span><strong>{terapista.estado === "ACTIVA" ? "Activa" : "Inactiva"}</strong></div>
        </section>

        {query.updated === "1" && <div className="formMessage ok">Horario guardado correctamente.</div>}
        {query.error && <div className="formMessage error">No se pudo guardar el horario. Revisa que la hora de salida sea posterior a la entrada.</div>}
        {(terapistaResult.error || horarioResult.error) && (
          <div className="alert">No se pudo cargar toda la información del horario.</div>
        )}

        <form action={updateHorarioHabitualAction} className="atencionForm">
          <input type="hidden" name="terapista_id" value={terapistaId} />
          <div className="miniList">
            {DIAS.map(([dia, nombre]) => {
              const row = byDay.get(dia);
              const trabaja = row?.trabaja ?? false;
              return (
                <fieldset className="formSection" key={dia}>
                  <legend className="formSectionTitle">{nombre}</legend>
                  <div className="atencionGrid">
                    <label className="catalogCheckbox">
                      <input name={`trabaja_${dia}`} type="checkbox" defaultChecked={trabaja} disabled={!canEdit} />
                      Trabaja este día
                    </label>
                    <label className="atencionField">
                      Entrada
                      <input name={`hora_inicio_${dia}`} type="time" defaultValue={hhmm(row?.hora_inicio ?? null)} disabled={!canEdit} />
                    </label>
                    <label className="atencionField">
                      Salida
                      <input name={`hora_fin_${dia}`} type="time" defaultValue={hhmm(row?.hora_fin ?? null)} disabled={!canEdit} />
                    </label>
                    <label className="atencionField">
                      Sede
                      <select name={`sede_${dia}`} defaultValue={row?.sede ?? ""} disabled={!canEdit}>
                        <option value="">Sin definir</option>
                        <option value="Miraflores">Miraflores</option>
                        <option value="San Borja">San Borja</option>
                        <option value="Ambas">Ambas</option>
                      </select>
                    </label>
                    <label className="atencionField atencionFieldWide">
                      Observación
                      <input name={`observacion_${dia}`} defaultValue={row?.observacion ?? ""} disabled={!canEdit} placeholder="Opcional" />
                    </label>
                  </div>
                </fieldset>
              );
            })}
          </div>

          {canEdit && (
            <button className="primaryButton" type="submit" style={{ width: "100%", marginTop: "16px", minHeight: "50px" }}>
              Guardar horario habitual
            </button>
          )}
        </form>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "18px" }}>
          <Link className="ghostButton" href={`/terapistas/${terapistaId}`}>Volver a la ficha</Link>
          <Link className="ghostButton" href="/horarios">Ver horarios de todas</Link>
        </div>
      </section>
    </main>
  );
}

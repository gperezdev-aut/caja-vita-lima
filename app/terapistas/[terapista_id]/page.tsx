import Link from "next/link";
import { notFound } from "next/navigation";
import { CajaSidebar } from "@/components/CajaSidebar";
import { requireModuleAccess } from "@/lib/auth";
import { supabaseSelectWhere } from "@/lib/supabaseServer";

type TerapistaRow = {
  terapista_id: string;
  nombre: string;
  telefono: string | null;
  sede_habitual: string | null;
  fecha_ingreso: string | null;
  estado: "ACTIVA" | "INACTIVA";
  observacion: string | null;
  created_at: string;
  updated_at: string;
};

type AliasRow = {
  alias: string;
  nota: string | null;
};

export default async function TerapistaFichaPage({
  params,
}: {
  params: Promise<{ terapista_id: string }>;
}) {
  const session = await requireModuleAccess("terapistas");
  const terapistaId = (await params).terapista_id;

  const [terapistaResult, aliasResult] = await Promise.all([
    supabaseSelectWhere<TerapistaRow>(
      "terapistas",
      `select=*&terapista_id=eq.${encodeURIComponent(terapistaId)}&limit=1`
    ),
    supabaseSelectWhere<AliasRow>(
      "terapista_aliases",
      `select=alias,nota&terapista_id=eq.${encodeURIComponent(terapistaId)}&order=alias.asc`
    ),
  ]);

  const terapista = terapistaResult.data[0];
  if (!terapista) notFound();

  const errors = [terapistaResult.error, aliasResult.error].filter(Boolean);

  return (
    <main className="appShell">
      <CajaSidebar session={session} />
      <section className="page">
        <section className="hero" style={{ minHeight: "145px" }}>
          <div>
            <p className="eyebrow">Ficha de terapista</p>
            <h1>{terapista.nombre}</h1>
            <p className="subtitle">
              {terapista.estado === "ACTIVA" ? "Terapista activa" : "Terapista inactiva"}
              {terapista.sede_habitual ? ` · ${terapista.sede_habitual}` : " · sede habitual pendiente"}
            </p>
          </div>
          <div className="badge">
            <span>Estado</span>
            <strong>{terapista.estado === "ACTIVA" ? "Activa" : "Inactiva"}</strong>
          </div>
        </section>

        {errors.length > 0 && (
          <div className="alert">No se pudo cargar toda la ficha: {errors.join(" · ")}</div>
        )}

        <section className="panel">
          <div className="panelTitle">
            <div>
              <h2>Información</h2>
              <p>Datos base que luego alimentarán horario, disponibilidad y reportes.</p>
            </div>
          </div>

          <div className="currentMonth">
            <div>
              <span>Nombre</span>
              <strong>{terapista.nombre}</strong>
            </div>
            <div>
              <span>Teléfono</span>
              <strong>{terapista.telefono || "Pendiente"}</strong>
            </div>
            <div>
              <span>Sede habitual</span>
              <strong>{terapista.sede_habitual || "Pendiente"}</strong>
            </div>
            <div>
              <span>Fecha de ingreso</span>
              <strong>{terapista.fecha_ingreso || "Pendiente"}</strong>
            </div>
          </div>
        </section>

        <section className="twoCols">
          <div className="panel">
            <div className="panelTitle">
              <div>
                <h2>Alias históricos</h2>
                <p>Permiten reconocer nombres antiguos sin alterar atenciones pasadas.</p>
              </div>
            </div>
            <div className="miniList">
              {aliasResult.data.length === 0 ? (
                <div className="miniItem"><span>Sin alias registrados</span></div>
              ) : (
                aliasResult.data.map((row) => (
                  <div className="miniItem" key={row.alias}>
                    <span>{row.alias}</span>
                    <strong>{row.nota || "Alias histórico"}</strong>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panelTitle">
              <div>
                <h2>Horario habitual</h2>
                <p>Se implementará en la siguiente fase sobre esta misma ficha.</p>
              </div>
            </div>
            <div className="miniList">
              <div className="miniItem">
                <span>Estado</span>
                <strong>Pendiente de configurar</strong>
              </div>
            </div>
          </div>
        </section>

        {terapista.observacion && (
          <section className="panel">
            <div className="panelTitle">
              <div><h2>Observación</h2></div>
            </div>
            <p style={{ margin: 0, lineHeight: 1.6 }}>{terapista.observacion}</p>
          </section>
        )}

        <Link className="ghostButton" href="/terapistas">
          Volver a terapistas
        </Link>
      </section>
    </main>
  );
}

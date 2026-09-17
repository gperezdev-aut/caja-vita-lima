import Link from "next/link";
import { CajaSidebar } from "@/components/CajaSidebar";
import { requireModuleAccess } from "@/lib/auth";
import { supabaseSelect } from "@/lib/supabaseServer";

type TerapistaRow = {
  terapista_id: string;
  nombre: string;
  telefono: string | null;
  sede_habitual: string | null;
  fecha_ingreso: string | null;
  estado: "ACTIVA" | "INACTIVA";
  observacion: string | null;
};

export default async function TerapistasPage() {
  const session = await requireModuleAccess("terapistas");
  const result = await supabaseSelect<TerapistaRow>("terapistas");
  const rows = [...result.data].sort((a, b) => {
    if (a.estado !== b.estado) return a.estado === "ACTIVA" ? -1 : 1;
    return a.nombre.localeCompare(b.nombre, "es");
  });
  const activas = rows.filter((row) => row.estado === "ACTIVA").length;

  return (
    <main className="appShell">
      <CajaSidebar session={session} />
      <section className="page">
        <section className="hero" style={{ minHeight: "145px" }}>
          <div>
            <p className="eyebrow">Personal</p>
            <h1>Terapistas</h1>
            <p className="subtitle">Maestro operativo de terapistas. Las fichas inactivas se conservan para no perder historial.</p>
          </div>
          <div className="badge"><span>Activas</span><strong>{activas}</strong></div>
        </section>

        {result.error && <div className="alert">No se pudo cargar el maestro de terapistas: {result.error}</div>}

        <section className="panel">
          <div className="panelTitle">
            <div><h2>Personal actual</h2><p>Consulta la ficha, los datos laborales y el horario habitual de cada terapista.</p></div>
            <Link className="ghostButton" href="/horarios">Ver horarios</Link>
          </div>

          <div style={{ display: "grid", gap: "12px" }}>
            {rows.length === 0 && !result.error && <div className="miniItem"><span>No hay fichas registradas todavía.</span></div>}
            {rows.map((row) => (
              <Link key={row.terapista_id} href={`/terapistas/${row.terapista_id}`} style={{ textDecoration: "none", color: "inherit" }}>
                <article style={{ border: "1px solid var(--line)", borderRadius: "18px", background: "white", padding: "16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
                  <div>
                    <strong style={{ display: "block", fontSize: "18px", marginBottom: "5px" }}>{row.nombre}</strong>
                    <span style={{ color: "var(--muted)", fontSize: "14px" }}>{row.sede_habitual || "Sede habitual pendiente"}</span>
                  </div>
                  <span style={{ borderRadius: "999px", padding: "7px 11px", fontSize: "12px", fontWeight: 850, background: row.estado === "ACTIVA" ? "var(--green-soft)" : "var(--warn)", color: row.estado === "ACTIVA" ? "var(--green)" : "var(--text)" }}>
                    {row.estado === "ACTIVA" ? "Activa" : "Inactiva"}
                  </span>
                </article>
              </Link>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

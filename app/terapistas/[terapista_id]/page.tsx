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
};

type AliasRow = { alias: string; nota: string | null };

type PersonalRow = {
  nombre_completo: string | null;
  direccion: string | null;
  fecha_nacimiento: string | null;
  dni: string | null;
  ruc: string | null;
  estado_civil: string | null;
  hijos: number | null;
  correo: string | null;
  contacto_emergencia: string | null;
  telefono_emergencia: string | null;
  relacion_contacto: string | null;
};

type LaboralRow = {
  codigo_marcacion: string | null;
  llaves: boolean | null;
  observacion_laboral: string | null;
};

type PagoRow = {
  banco: string | null;
  cuenta_soles: string | null;
  afp: string | null;
};

type UniformeRow = {
  uniforme_id: number;
  prenda: string;
  talla: string | null;
  cantidad: number | null;
};

function value(value: unknown) {
  if (value === null || value === undefined || value === "") return "Pendiente";
  return String(value);
}

function DataGrid({ items }: { items: { label: string; value: unknown }[] }) {
  return (
    <div className="currentMonth">
      {items.map((item) => (
        <div key={item.label}>
          <span>{item.label}</span>
          <strong>{value(item.value)}</strong>
        </div>
      ))}
    </div>
  );
}

export default async function TerapistaFichaPage({
  params,
}: {
  params: Promise<{ terapista_id: string }>;
}) {
  const session = await requireModuleAccess("terapistas");
  const terapistaId = (await params).terapista_id;
  const isAdmin = session.rol === "ADMIN_GERALD";

  const [terapistaResult, aliasResult, laboralResult, uniformeResult] = await Promise.all([
    supabaseSelectWhere<TerapistaRow>(
      "terapistas",
      `select=*&terapista_id=eq.${encodeURIComponent(terapistaId)}&limit=1`
    ),
    supabaseSelectWhere<AliasRow>(
      "terapista_aliases",
      `select=alias,nota&terapista_id=eq.${encodeURIComponent(terapistaId)}&order=alias.asc`
    ),
    supabaseSelectWhere<LaboralRow>(
      "terapista_datos_laborales",
      `select=codigo_marcacion,llaves,observacion_laboral&terapista_id=eq.${encodeURIComponent(terapistaId)}&limit=1`
    ),
    supabaseSelectWhere<UniformeRow>(
      "terapista_uniforme",
      `select=uniforme_id,prenda,talla,cantidad&terapista_id=eq.${encodeURIComponent(terapistaId)}&order=prenda.asc`
    ),
  ]);

  const terapista = terapistaResult.data[0];
  if (!terapista) notFound();

  let personal: PersonalRow | null = null;
  let pago: PagoRow | null = null;
  let privateErrors: string[] = [];

  if (isAdmin) {
    const [personalResult, pagoResult] = await Promise.all([
      supabaseSelectWhere<PersonalRow>(
        "terapista_datos_personales",
        `select=nombre_completo,direccion,fecha_nacimiento,dni,ruc,estado_civil,hijos,correo,contacto_emergencia,telefono_emergencia,relacion_contacto&terapista_id=eq.${encodeURIComponent(terapistaId)}&limit=1`
      ),
      supabaseSelectWhere<PagoRow>(
        "terapista_datos_pago",
        `select=banco,cuenta_soles,afp&terapista_id=eq.${encodeURIComponent(terapistaId)}&limit=1`
      ),
    ]);
    personal = personalResult.data[0] ?? null;
    pago = pagoResult.data[0] ?? null;
    privateErrors = [personalResult.error, pagoResult.error].filter(Boolean) as string[];
  }

  const laboral = laboralResult.data[0] ?? null;
  const errors = [
    terapistaResult.error,
    aliasResult.error,
    laboralResult.error,
    uniformeResult.error,
    ...privateErrors,
  ].filter(Boolean);

  return (
    <main className="appShell">
      <CajaSidebar session={session} />
      <section className="page">
        <section className="hero" style={{ minHeight: "145px" }}>
          <div>
            <p className="eyebrow">Ficha de terapista</p>
            <h1>{personal?.nombre_completo || terapista.nombre}</h1>
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
              <h2>Datos laborales</h2>
              <p>Información operativa del vínculo con Vita Lima.</p>
            </div>
          </div>
          <DataGrid
            items={[
              { label: "Nombre operativo", value: terapista.nombre },
              { label: "Teléfono", value: terapista.telefono },
              { label: "Sede habitual", value: terapista.sede_habitual },
              { label: "Fecha de ingreso", value: terapista.fecha_ingreso },
              { label: "Código de marcación", value: laboral?.codigo_marcacion },
              { label: "Llaves", value: laboral?.llaves === null || laboral?.llaves === undefined ? null : laboral.llaves ? "Sí" : "No" },
            ]}
          />
        </section>

        {isAdmin ? (
          <>
            <section className="panel">
              <div className="panelTitle">
                <div>
                  <h2>Datos personales</h2>
                  <p>Información privada de la ficha de personal.</p>
                </div>
              </div>
              <DataGrid
                items={[
                  { label: "Nombre y apellidos", value: personal?.nombre_completo },
                  { label: "Dirección", value: personal?.direccion },
                  { label: "Fecha de nacimiento", value: personal?.fecha_nacimiento },
                  { label: "DNI", value: personal?.dni },
                  { label: "RUC", value: personal?.ruc },
                  { label: "Estado civil", value: personal?.estado_civil },
                  { label: "Hijos", value: personal?.hijos },
                  { label: "Correo", value: personal?.correo },
                ]}
              />
            </section>

            <section className="twoCols">
              <div className="panel">
                <div className="panelTitle">
                  <div>
                    <h2>Contacto de emergencia</h2>
                    <p>Datos para una eventual emergencia.</p>
                  </div>
                </div>
                <DataGrid
                  items={[
                    { label: "Contacto", value: personal?.contacto_emergencia },
                    { label: "Teléfono", value: personal?.telefono_emergencia },
                    { label: "Relación", value: personal?.relacion_contacto },
                  ]}
                />
              </div>

              <div className="panel">
                <div className="panelTitle">
                  <div>
                    <h2>Pago y AFP</h2>
                    <p>Visible únicamente para administración.</p>
                  </div>
                </div>
                <DataGrid
                  items={[
                    { label: "Banco", value: pago?.banco },
                    { label: "Cuenta en soles", value: pago?.cuenta_soles },
                    { label: "AFP", value: pago?.afp },
                  ]}
                />
              </div>
            </section>
          </>
        ) : (
          <div className="alert">Los datos personales, de emergencia y bancarios están restringidos a administración.</div>
        )}

        <section className="twoCols">
          <div className="panel">
            <div className="panelTitle">
              <div>
                <h2>Uniforme</h2>
                <p>Tallas y cantidades entregadas o requeridas.</p>
              </div>
            </div>
            <div className="miniList">
              {uniformeResult.data.length === 0 ? (
                <div className="miniItem"><span>Sin prendas registradas</span></div>
              ) : (
                uniformeResult.data.map((row) => (
                  <div className="miniItem" key={row.uniforme_id}>
                    <span>{row.prenda}</span>
                    <strong>{row.talla || "Sin talla"}{row.cantidad ? ` · ${row.cantidad}` : ""}</strong>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panelTitle">
              <div>
                <h2>Alias históricos</h2>
                <p>Reconocen nombres antiguos sin tocar atenciones pasadas.</p>
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
        </section>

        <section className="panel">
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
        </section>

        {(laboral?.observacion_laboral || terapista.observacion) && (
          <section className="panel">
            <div className="panelTitle"><div><h2>Observaciones</h2></div></div>
            <p style={{ margin: 0, lineHeight: 1.6 }}>
              {[terapista.observacion, laboral?.observacion_laboral].filter(Boolean).join(" · ")}
            </p>
          </section>
        )}

        <Link className="ghostButton" href="/terapistas">Volver a terapistas</Link>
      </section>
    </main>
  );
}

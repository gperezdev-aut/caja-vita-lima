import Link from "next/link";
import { notFound } from "next/navigation";
import { CajaSidebar } from "@/components/CajaSidebar";
import { requireModuleAccess } from "@/lib/auth";
import { supabaseSelectWhere } from "@/lib/supabaseServer";
import { updateTerapistaFichaAction } from "./actions";

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
type LaboralRow = { codigo_marcacion: string | null; llaves: boolean | null; observacion_laboral: string | null };
type PagoRow = { banco: string | null; cuenta_soles: string | null; afp: string | null };
type UniformeRow = { uniforme_id: number; prenda: string; talla: string | null; cantidad: number | null };
type HorarioRow = { dia_semana: number; trabaja: boolean; hora_inicio: string | null; hora_fin: string | null; sede: string | null };

const DIAS = [
  [1, "Lun"], [2, "Mar"], [3, "Mié"], [4, "Jue"], [5, "Vie"], [6, "Sáb"], [7, "Dom"],
] as const;

function value(input: unknown) {
  if (input === null || input === undefined || input === "") return "Pendiente";
  return String(input);
}

function DataGrid({ items }: { items: { label: string; value: unknown }[] }) {
  return <div className="currentMonth">{items.map((item) => <div key={item.label}><span>{item.label}</span><strong>{value(item.value)}</strong></div>)}</div>;
}

function uniformValue(rows: UniformeRow[], prenda: string) {
  return rows.find((row) => row.prenda === prenda) ?? null;
}

function hhmm(value: string | null) {
  return value ? value.slice(0, 5) : "";
}

function horarioLabel(row: HorarioRow | undefined) {
  if (!row || !row.trabaja) return "Descanso";
  const range = `${hhmm(row.hora_inicio)}–${hhmm(row.hora_fin)}`;
  return row.sede ? `${range} · ${row.sede}` : range;
}

function errorMessage(code: string | undefined) {
  if (!code) return "";
  if (code === "dni") return "El DNI debe tener exactamente 8 dígitos.";
  if (code === "ruc") return "El RUC debe tener exactamente 11 dígitos.";
  if (code === "codigo_marcacion") return "El código de marcación debe tener 4 dígitos.";
  if (code === "sin_permisos") return "Solo administración puede editar esta ficha.";
  return "No se pudo guardar la ficha. Revisa los datos e inténtalo nuevamente.";
}

export default async function TerapistaFichaPage({
  params,
  searchParams,
}: {
  params: Promise<{ terapista_id: string }>;
  searchParams: Promise<{ updated?: string; error?: string }>;
}) {
  const session = await requireModuleAccess("terapistas");
  const terapistaId = (await params).terapista_id;
  const query = await searchParams;
  const canManage = session.rol === "ADMIN_GERALD" || session.rol === "SOCIO";

  const [terapistaResult, aliasResult, laboralResult, uniformeResult, horarioResult] = await Promise.all([
    supabaseSelectWhere<TerapistaRow>("terapistas", `select=*&terapista_id=eq.${encodeURIComponent(terapistaId)}&limit=1`),
    supabaseSelectWhere<AliasRow>("terapista_aliases", `select=alias,nota&terapista_id=eq.${encodeURIComponent(terapistaId)}&order=alias.asc`),
    supabaseSelectWhere<LaboralRow>("terapista_datos_laborales", `select=codigo_marcacion,llaves,observacion_laboral&terapista_id=eq.${encodeURIComponent(terapistaId)}&limit=1`),
    supabaseSelectWhere<UniformeRow>("terapista_uniforme", `select=uniforme_id,prenda,talla,cantidad&terapista_id=eq.${encodeURIComponent(terapistaId)}&order=prenda.asc`),
    supabaseSelectWhere<HorarioRow>("terapista_horario_habitual", `select=dia_semana,trabaja,hora_inicio,hora_fin,sede&terapista_id=eq.${encodeURIComponent(terapistaId)}&order=dia_semana.asc`),
  ]);

  const terapista = terapistaResult.data[0];
  if (!terapista) notFound();

  let personal: PersonalRow | null = null;
  let pago: PagoRow | null = null;
  let privateErrors: string[] = [];

  if (canManage) {
    const [personalResult, pagoResult] = await Promise.all([
      supabaseSelectWhere<PersonalRow>("terapista_datos_personales", `select=nombre_completo,direccion,fecha_nacimiento,dni,ruc,estado_civil,hijos,correo,contacto_emergencia,telefono_emergencia,relacion_contacto&terapista_id=eq.${encodeURIComponent(terapistaId)}&limit=1`),
      supabaseSelectWhere<PagoRow>("terapista_datos_pago", `select=banco,cuenta_soles,afp&terapista_id=eq.${encodeURIComponent(terapistaId)}&limit=1`),
    ]);
    personal = personalResult.data[0] ?? null;
    pago = pagoResult.data[0] ?? null;
    privateErrors = [personalResult.error, pagoResult.error].filter(Boolean) as string[];
  }

  const laboral = laboralResult.data[0] ?? null;
  const pantalon = uniformValue(uniformeResult.data, "Pantalón");
  const chaqueta = uniformValue(uniformeResult.data, "Chaqueta");
  const casaca = uniformValue(uniformeResult.data, "Casaca");
  const visibleUniformes = uniformeResult.data.filter((row) => row.talla || row.cantidad);
  const horario = new Map(horarioResult.data.map((row) => [row.dia_semana, row]));

  const errors = [terapistaResult.error, aliasResult.error, laboralResult.error, uniformeResult.error, horarioResult.error, ...privateErrors].filter(Boolean);

  return (
    <main className="appShell">
      <CajaSidebar session={session} />
      <section className="page">
        <section className="hero" style={{ minHeight: "145px" }}>
          <div>
            <p className="eyebrow">Ficha de terapista</p>
            <h1>{personal?.nombre_completo || terapista.nombre}</h1>
            <p className="subtitle">{terapista.estado === "ACTIVA" ? "Terapista activa" : "Terapista inactiva"}{terapista.sede_habitual ? ` · ${terapista.sede_habitual}` : " · sede habitual pendiente"}</p>
          </div>
          <div className="badge"><span>Estado</span><strong>{terapista.estado === "ACTIVA" ? "Activa" : "Inactiva"}</strong></div>
        </section>

        {query.updated === "1" && <div className="formMessage ok">Ficha actualizada correctamente.</div>}
        {query.error && <div className="formMessage error">{errorMessage(query.error)}</div>}
        {errors.length > 0 && <div className="alert">No se pudo cargar toda la ficha: {errors.join(" · ")}</div>}

        {canManage && (
          <form action={updateTerapistaFichaAction} className="atencionForm" style={{ marginBottom: "24px" }}>
            <input type="hidden" name="terapista_id" value={terapistaId} />
            <div className="panelTitle"><div><h2>Editar ficha</h2><p>Actualiza aquí la información que antes vivía en el Excel de personal.</p></div></div>

            <fieldset className="formSection"><legend className="formSectionTitle">Datos laborales</legend><div className="atencionGrid">
              <label className="atencionField">Nombre operativo<input value={terapista.nombre} readOnly /><small>El nombre operativo se mantiene estable para proteger el histórico.</small></label>
              <label className="atencionField">Teléfono<input name="telefono" defaultValue={terapista.telefono ?? ""} inputMode="tel" /></label>
              <label className="atencionField">Sede habitual<select name="sede_habitual" defaultValue={terapista.sede_habitual ?? ""}><option value="">Sin definir</option><option value="Miraflores">Miraflores</option><option value="San Borja">San Borja</option><option value="Ambas">Ambas</option></select></label>
              <label className="atencionField">Fecha de ingreso<input name="fecha_ingreso" type="date" defaultValue={terapista.fecha_ingreso ?? ""} /></label>
              <label className="atencionField">Código de marcación<input name="codigo_marcacion" defaultValue={laboral?.codigo_marcacion ?? ""} inputMode="numeric" maxLength={4} /></label>
              <label className="atencionField">Llaves<select name="llaves" defaultValue={laboral?.llaves === true ? "SI" : laboral?.llaves === false ? "NO" : ""}><option value="">Sin definir</option><option value="SI">Sí</option><option value="NO">No</option></select></label>
              <label className="atencionField atencionFieldWide">Observación laboral<textarea name="observacion_laboral" defaultValue={laboral?.observacion_laboral ?? ""} /></label>
              <label className="atencionField atencionFieldWide">Observación general<textarea name="observacion" defaultValue={terapista.observacion ?? ""} /></label>
            </div></fieldset>

            <fieldset className="formSection"><legend className="formSectionTitle">Datos personales</legend><div className="atencionGrid">
              <label className="atencionField atencionFieldWide">Nombre y apellidos<input name="nombre_completo" defaultValue={personal?.nombre_completo ?? ""} /></label>
              <label className="atencionField atencionFieldWide">Dirección<input name="direccion" defaultValue={personal?.direccion ?? ""} /></label>
              <label className="atencionField">Fecha de nacimiento<input name="fecha_nacimiento" type="date" defaultValue={personal?.fecha_nacimiento ?? ""} /></label>
              <label className="atencionField">DNI<input name="dni" defaultValue={personal?.dni ?? ""} inputMode="numeric" maxLength={8} /></label>
              <label className="atencionField">RUC<input name="ruc" defaultValue={personal?.ruc ?? ""} inputMode="numeric" maxLength={11} /></label>
              <label className="atencionField">Estado civil<input name="estado_civil" defaultValue={personal?.estado_civil ?? ""} /></label>
              <label className="atencionField">Hijos<input name="hijos" type="number" min={0} defaultValue={personal?.hijos ?? ""} /></label>
              <label className="atencionField atencionFieldWide">Correo<input name="correo" type="email" defaultValue={personal?.correo ?? ""} /></label>
            </div></fieldset>

            <fieldset className="formSection"><legend className="formSectionTitle">Contacto de emergencia</legend><div className="atencionGrid">
              <label className="atencionField atencionFieldWide">Nombre del contacto<input name="contacto_emergencia" defaultValue={personal?.contacto_emergencia ?? ""} /></label>
              <label className="atencionField">Teléfono<input name="telefono_emergencia" defaultValue={personal?.telefono_emergencia ?? ""} inputMode="tel" /></label>
              <label className="atencionField">Relación<input name="relacion_contacto" defaultValue={personal?.relacion_contacto ?? ""} placeholder="Ej. madre, pareja, hermana" /></label>
            </div></fieldset>

            <fieldset className="formSection"><legend className="formSectionTitle">Pago y AFP</legend><div className="atencionGrid">
              <label className="atencionField">Banco<input name="banco" defaultValue={pago?.banco ?? ""} /></label>
              <label className="atencionField atencionFieldWide">Cuenta en soles<input name="cuenta_soles" defaultValue={pago?.cuenta_soles ?? ""} inputMode="numeric" /></label>
              <label className="atencionField">AFP<input name="afp" defaultValue={pago?.afp ?? ""} /></label>
            </div></fieldset>

            <fieldset className="formSection"><legend className="formSectionTitle">Uniforme</legend><div className="atencionGrid">
              <label className="atencionField">Pantalón · talla<input name="uniforme_pantalon_talla" defaultValue={pantalon?.talla ?? ""} /></label>
              <label className="atencionField">Pantalón · cantidad<input name="uniforme_pantalon_cantidad" type="number" min={1} defaultValue={pantalon?.cantidad ?? ""} /></label>
              <label className="atencionField">Chaqueta · talla<input name="uniforme_chaqueta_talla" defaultValue={chaqueta?.talla ?? ""} /></label>
              <label className="atencionField">Chaqueta · cantidad<input name="uniforme_chaqueta_cantidad" type="number" min={1} defaultValue={chaqueta?.cantidad ?? ""} /></label>
              <label className="atencionField">Casaca · talla<input name="uniforme_casaca_talla" defaultValue={casaca?.talla ?? ""} /></label>
              <label className="atencionField">Casaca · cantidad<input name="uniforme_casaca_cantidad" type="number" min={1} defaultValue={casaca?.cantidad ?? ""} /></label>
            </div></fieldset>

            <button className="primaryButton" type="submit" style={{ width: "100%", marginTop: "16px", minHeight: "50px" }}>Guardar ficha</button>
          </form>
        )}

        <section className="panel"><div className="panelTitle"><div><h2>Horario habitual</h2><p>Patrón base semanal de esta terapista.</p></div><Link className="ghostButton" href={`/terapistas/${terapistaId}/horario`}>Editar horario</Link></div>
          <div className="tableWrap"><table style={{ minWidth: "760px" }}><thead><tr>{DIAS.map(([, nombre]) => <th key={nombre}>{nombre}</th>)}</tr></thead><tbody><tr>{DIAS.map(([dia, nombre]) => <td key={nombre}><strong>{horarioLabel(horario.get(dia))}</strong></td>)}</tr></tbody></table></div>
        </section>

        <section className="panel"><div className="panelTitle"><div><h2>Datos laborales</h2><p>Información operativa del vínculo con Vita Lima.</p></div></div><DataGrid items={[
          { label: "Nombre operativo", value: terapista.nombre }, { label: "Teléfono", value: terapista.telefono }, { label: "Sede habitual", value: terapista.sede_habitual }, { label: "Fecha de ingreso", value: terapista.fecha_ingreso }, { label: "Código de marcación", value: laboral?.codigo_marcacion }, { label: "Llaves", value: laboral?.llaves === null || laboral?.llaves === undefined ? null : laboral.llaves ? "Sí" : "No" },
        ]} /></section>

        {canManage ? <>
          <section className="panel"><div className="panelTitle"><div><h2>Datos personales</h2><p>Información privada de la ficha de personal.</p></div></div><DataGrid items={[
            { label: "Nombre y apellidos", value: personal?.nombre_completo }, { label: "Dirección", value: personal?.direccion }, { label: "Fecha de nacimiento", value: personal?.fecha_nacimiento }, { label: "DNI", value: personal?.dni }, { label: "RUC", value: personal?.ruc }, { label: "Estado civil", value: personal?.estado_civil }, { label: "Hijos", value: personal?.hijos }, { label: "Correo", value: personal?.correo },
          ]} /></section>
          <section className="twoCols"><div className="panel"><div className="panelTitle"><div><h2>Contacto de emergencia</h2><p>Datos para una eventual emergencia.</p></div></div><DataGrid items={[
            { label: "Contacto", value: personal?.contacto_emergencia }, { label: "Teléfono", value: personal?.telefono_emergencia }, { label: "Relación", value: personal?.relacion_contacto },
          ]} /></div><div className="panel"><div className="panelTitle"><div><h2>Pago y AFP</h2><p>Visible para administración.</p></div></div><DataGrid items={[
            { label: "Banco", value: pago?.banco }, { label: "Cuenta en soles", value: pago?.cuenta_soles }, { label: "AFP", value: pago?.afp },
          ]} /></div></section>
        </> : <div className="alert">Los datos personales, de emergencia y bancarios están restringidos a administración.</div>}

        <section className="twoCols"><div className="panel"><div className="panelTitle"><div><h2>Uniforme</h2><p>Tallas y cantidades registradas.</p></div></div><div className="miniList">{visibleUniformes.length === 0 ? <div className="miniItem"><span>Sin prendas registradas</span></div> : visibleUniformes.map((row) => <div className="miniItem" key={row.uniforme_id}><span>{row.prenda}</span><strong>{row.talla || "Sin talla"}{row.cantidad ? ` · ${row.cantidad}` : ""}</strong></div>)}</div></div>
          <div className="panel"><div className="panelTitle"><div><h2>Alias históricos</h2><p>Reconocen nombres antiguos sin tocar atenciones pasadas.</p></div></div><div className="miniList">{aliasResult.data.length === 0 ? <div className="miniItem"><span>Sin alias registrados</span></div> : aliasResult.data.map((row) => <div className="miniItem" key={row.alias}><span>{row.alias}</span><strong>{row.nota || "Alias histórico"}</strong></div>)}</div></div></section>

        {(laboral?.observacion_laboral || terapista.observacion) && <section className="panel"><div className="panelTitle"><div><h2>Observaciones</h2></div></div><p style={{ margin: 0, lineHeight: 1.6 }}>{[terapista.observacion, laboral?.observacion_laboral].filter(Boolean).join(" · ")}</p></section>}

        <Link className="ghostButton" href="/terapistas">Volver a terapistas</Link>
      </section>
    </main>
  );
}

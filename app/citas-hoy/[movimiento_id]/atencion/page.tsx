import { randomUUID } from "crypto";
import { notFound } from "next/navigation";
import { CajaSidebar } from "@/components/CajaSidebar";
import { Badge } from "@/components/Badge";
import { requireModuleAccess } from "@/lib/auth";
import { displayText } from "@/lib/displayText";
import { supabaseSelect, supabaseSelectWhere } from "@/lib/supabaseServer";
import { AtencionReservadaForm } from "./AtencionReservadaForm";

type Row = Record<string, unknown>;

function orderedValues(rows: Row[], lista: string) {
  return rows
    .filter((row) => row.lista === lista && row.activo !== false)
    .sort((a, b) => Number(a.orden ?? 0) - Number(b.orden ?? 0))
    .map((row) => String(row.valor ?? ""))
    .filter(Boolean);
}

function money(value: unknown) {
  return `S/ ${Number(value ?? 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function normalizeService(value: unknown) {
  return displayText(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export default async function AtencionReservadaPage({ params }: { params: Promise<{ movimiento_id: string }> }) {
  const session = await requireModuleAccess("citas-hoy");
  const esAdministracion = session.rol !== "VITA_OPERACION";
  const movimientoId = (await params).movimiento_id;

  const movimientoResult = await supabaseSelectWhere<Row>(
    "caja_movimientos",
    `select=movimiento_id,source_id,tipo_movimiento,estado,cliente_id,cliente,whatsapp,n_pax,servicio,sede,total_cobrar,total_pagado,pendiente,estado_boleta,tipo_comprobante,estado_comprobante_manual&movimiento_id=eq.${encodeURIComponent(movimientoId)}&limit=1`
  );
  const movimiento = movimientoResult.data[0];
  if (!movimiento) notFound();

  const sourceId = String(movimiento.source_id ?? "");
  const [reservaResult, detallesResult, configResult, holdResult, convenioResult, terapistasMaestroResult, aliasesResult, releaseResult, propinaResult] = await Promise.all([
    sourceId
      ? supabaseSelectWhere<Row>("citas_reservadas", `select=reserva_id,source_id,cliente_id,estado,estado_ficha,requiere_confirmacion,confirmado_en,atencion_personalizada,tipo_atencion,canal&reserva_id=eq.${encodeURIComponent(sourceId)}&limit=1`)
      : Promise.resolve({ data: [] as Row[], error: null }),
    supabaseSelectWhere<Row>("caja_atencion_detalle", `select=persona_n,terapista,terapista_otro&movimiento_id=eq.${encodeURIComponent(movimientoId)}&order=persona_n.asc`),
    supabaseSelect<Row>("config_listas"),
    sourceId
      ? supabaseSelectWhere<Row>("gift_card_reservas", `select=monto_reservado,estado,giftcard_id&reserva_id=eq.${encodeURIComponent(sourceId)}&estado=in.(ACTIVA,CANJEADA)&limit=1`)
      : Promise.resolve({ data: [] as Row[], error: null }),
    sourceId
      ? supabaseSelectWhere<Row>("cupones_convenios", `select=registro_id,plataforma,monto_reconocido,estado&reserva_id=eq.${encodeURIComponent(sourceId)}&limit=1`)
      : Promise.resolve({ data: [] as Row[], error: null }),
    supabaseSelectWhere<Row>("terapistas", "select=terapista_id,nombre,estado&estado=eq.ACTIVA&order=nombre.asc"),
    supabaseSelectWhere<Row>("terapista_aliases", "select=alias,terapista_id"),
    supabaseSelectWhere<Row>("caja_catalog_releases", "select=release_id&active=eq.true&limit=1"),
    supabaseSelectWhere<Row>("caja_propinas", `select=propina_id,monto,metodo,estado&movimiento_id=eq.${encodeURIComponent(movimientoId)}&order=created_at.desc&limit=1`),
  ]);

  const reserva = reservaResult.data[0];
  const convenio = convenioResult.data[0];
  const esConvenio = Boolean(reserva && ["cuponidad", "bee"].includes(String(reserva.canal ?? "")));
  const convenioListo = !esConvenio || Boolean(
    reserva?.estado_ficha === "completa" &&
    convenio?.estado === "verificado" &&
    Number(convenio?.monto_reconocido ?? 0) > 0
  );
  const esDirecta = !reserva && movimiento.tipo_movimiento === "ATENCION_APP";
  const reservaId = reserva ? String(reserva.reserva_id ?? "") : "";
  const relacionValida = esDirecta || Boolean(
    reserva && String(reserva.source_id ?? "") === movimientoId &&
    String(reserva.cliente_id ?? "") === String(movimiento.cliente_id ?? "")
  );
  const transicionable = esDirecta
    ? (movimiento.estado === "Registrado" || movimiento.estado === "En atención")
    : (
        (movimiento.tipo_movimiento === "RESERVA_APP" && movimiento.estado === "Reservado" && reserva?.estado === "PENDIENTE") ||
        (movimiento.tipo_movimiento === "RESERVA_APP" && movimiento.estado === "Cupón verificado" && reserva?.estado === "PENDIENTE" && convenioListo) ||
        (movimiento.tipo_movimiento === "ATENCION_APP" && movimiento.estado === "En atención" && reserva?.estado === "EN_ATENCION")
      );
  const confirmacionValida = esDirecta || reserva?.requiere_confirmacion !== true || Boolean(reserva?.confirmado_en);

  const terapeutasActuales: Record<number, string> = {};
  for (const detalle of detallesResult.data) {
    const persona = Number(detalle.persona_n);
    const terapeuta = String(detalle.terapista ?? "");
    if (Number.isInteger(persona) && terapeuta && terapeuta !== "Por asignar") terapeutasActuales[persona] = terapeuta;
  }

  const hold = holdResult.data[0];
  const giftCardSatisfecha = !hold || String(hold.estado ?? "") === "CANJEADA";
  const atencionCompletada = Boolean(
    relacionValida && movimiento.estado === "Atendido" && (esDirecta || reserva?.estado === "ATENDIDA_APP") && giftCardSatisfecha
  );

  const aliasPorTerapista = new Map<string, string[]>();
  for (const alias of aliasesResult.data) {
    const id = String(alias.terapista_id ?? "");
    const current = aliasPorTerapista.get(id) ?? [];
    current.push(String(alias.alias ?? ""));
    aliasPorTerapista.set(id, current);
  }
  const terapistasMaestro = terapistasMaestroResult.data
    .map((row) => ({
      id: String(row.terapista_id ?? ""),
      nombre: String(row.nombre ?? ""),
      aliases: aliasPorTerapista.get(String(row.terapista_id ?? "")) ?? [],
    }))
    .filter((row) => row.id && row.nombre);

  let servicioCatalogo: Row | undefined;
  const releaseId = String(releaseResult.data[0]?.release_id ?? "");
  let catalogError: string | null = null;
  if (releaseId) {
    const catalogResult = await supabaseSelectWhere<Row>(
      "caja_catalog_services",
      `select=name_es,included_es,duration_min,people_min,people_max&release_id=eq.${encodeURIComponent(releaseId)}&active=eq.true`
    );
    catalogError = catalogResult.error;
    const target = normalizeService(movimiento.servicio);
    servicioCatalogo = catalogResult.data.find((row) => normalizeService(row.name_es) === target);
  }

  const propina = propinaResult.data[0];
  let propinaBeneficiarias = "";
  if (propina?.propina_id) {
    const distribucion = await supabaseSelectWhere<Row>(
      "caja_propina_distribucion",
      `select=terapista_id,monto&propina_id=eq.${encodeURIComponent(String(propina.propina_id))}`
    );
    const names = new Map(terapistasMaestro.map((item) => [item.id, item.nombre]));
    propinaBeneficiarias = distribucion.data
      .filter((row) => Number(row.monto ?? 0) > 0)
      .map((row) => names.get(String(row.terapista_id ?? "")) ?? "Terapista")
      .join(" / ");
  }

  const errors = [
    movimientoResult.error,
    reservaResult.error,
    detallesResult.error,
    configResult.error,
    holdResult.error,
    convenioResult.error,
    terapistasMaestroResult.error,
    aliasesResult.error,
    releaseResult.error,
    propinaResult.error,
    catalogError,
  ].filter(Boolean);

  const comprobante = String(movimiento.estado_comprobante_manual || movimiento.estado_boleta || movimiento.tipo_comprobante || "No definido");
  const servicioNombre = displayText(movimiento.servicio ?? "-");
  const included = displayText(servicioCatalogo?.included_es ?? "").trim();
  const duration = Number(servicioCatalogo?.duration_min ?? 0);

  return (
    <main className="appShell">
      <CajaSidebar session={session} />
      <section className="page atencionReservadaPage">
        <section className="hero atencionReservadaHero" style={{ minHeight: "120px" }}>
          <div>
            <p className="eyebrow">{esDirecta ? "Atención directa" : "Reserva existente"}</p>
            <h1>{atencionCompletada ? "Atención completada" : "Completar atención"}</h1>
            <p className="subtitle">{String(movimiento.cliente ?? "-")} · {servicioNombre}</p>
          </div>
          <Badge>{String(movimiento.estado ?? "-")}</Badge>
        </section>

        <section className="panel" style={{ padding: "18px", marginBottom: "18px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: "10px" }}>
            <div><span style={{ color: "var(--muted)", fontSize: 12 }}>Sede</span><strong style={{ display: "block" }}>{String(movimiento.sede ?? "-")}</strong></div>
            <div><span style={{ color: "var(--muted)", fontSize: 12 }}>Personas</span><strong style={{ display: "block" }}>{String(movimiento.n_pax ?? 1)}</strong></div>
            <div><span style={{ color: "var(--muted)", fontSize: 12 }}>Total</span><strong style={{ display: "block" }}>{money(movimiento.total_cobrar)}</strong></div>
            <div><span style={{ color: "var(--muted)", fontSize: 12 }}>Pagado</span><strong style={{ display: "block" }}>{money(movimiento.total_pagado)}</strong></div>
            <div><span style={{ color: "var(--muted)", fontSize: 12 }}>Pendiente</span><strong style={{ display: "block", color: Number(movimiento.pendiente ?? 0) > 0 ? "#8a5a00" : "var(--green)" }}>{money(movimiento.pendiente)}</strong></div>
            {hold && <div><span style={{ color: "var(--muted)", fontSize: 12 }}>Gift Card</span><strong style={{ display: "block" }}>{money(hold.monto_reservado)}</strong></div>}
          </div>
          {(included || duration > 0) && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
              <strong>{servicioNombre}</strong>
              <p style={{ margin: "5px 0 0", color: "var(--muted)" }}>
                {duration > 0 ? `${duration} min` : ""}{duration > 0 && included ? " · " : ""}{included || ""}
              </p>
            </div>
          )}
          {esAdministracion && (
            <details className="technicalDetails" style={{ marginTop: 12 }}>
              <summary>Detalle administrativo / técnico</summary>
              <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                {reservaId && <code>Reserva: {reservaId}</code>}
                <code>Movimiento: {movimientoId}</code>
                {reserva && <span>Ficha: {String(reserva.estado_ficha ?? "-")} · Canal: {String(reserva.canal ?? "directo")}</span>}
              </div>
            </details>
          )}
        </section>

        {errors.length > 0 && <div className="alert">No se pudo cargar toda la información: {errors.join(" · ")}</div>}

        {atencionCompletada ? (
          <section className="panel">
            <div className="formMessage ok" style={{ marginBottom: "16px" }}>Atención completada correctamente.</div>
            <div className="reviewGrid" style={{ marginBottom: "18px" }}>
              <div><span>Total Vita Lima</span><strong>{money(movimiento.total_pagado)}</strong></div>
              {hold && <div><span>Gift Card</span><strong>{money(hold.monto_reservado)}</strong></div>}
              {propina && <div><span>Propina aparte</span><strong>{money(propina.monto)}</strong><small>{propinaBeneficiarias || "Terapista"} · {String(propina.metodo ?? "-")}</small></div>}
              <div className="reviewImportant"><span>Saldo pendiente</span><strong>{money(movimiento.pendiente)}</strong></div>
            </div>
            <a className="ghostButton" href="/citas-hoy">Volver a Citas de hoy</a>
          </section>
        ) : !relacionValida || !transicionable || !confirmacionValida || !convenioListo ? (
          <section className="panel">
            <div className="alert">Esta atención no es válida para la transición segura. Verifica relación, confirmación y estado antes de continuar.</div>
            <a href="/citas-hoy">Volver a Citas de hoy</a>
          </section>
        ) : (
          <AtencionReservadaForm
            requestId={randomUUID()}
            movimientoId={movimientoId}
            reservaId={reservaId}
            personas={Number(movimiento.n_pax ?? 0) || 1}
            total={Number(movimiento.total_cobrar ?? 0)}
            pagado={Number(movimiento.total_pagado ?? 0)}
            pendiente={Number(movimiento.pendiente ?? 0)}
            terapistas={orderedValues(configResult.data, "TERAPISTAS")}
            terapistasMaestro={terapistasMaestro}
            metodos={orderedValues(configResult.data, "METODOS_PAGO")}
            terapistasActuales={terapeutasActuales}
            comprobante={comprobante}
            estadoActual={movimiento.estado === "En atención" ? "En atención" : "Reservado"}
            coberturaGiftCard={Number(hold?.monto_reservado ?? 0)}
            giftCardId={String(hold?.estado ?? "") === "ACTIVA" ? String(hold?.giftcard_id ?? "") || null : null}
            convenioInicial={convenio && convenio.estado === "verificado" ? {
              tipo: String(convenio.plataforma ?? "").toUpperCase().includes("CUPONIDAD") ? "CONVENIO_CUPONIDAD" : "CONVENIO_BEE",
              referenciaId: String(convenio.registro_id ?? ""),
              monto: Number(convenio.monto_reconocido ?? 0),
              proveedor: String(convenio.plataforma ?? ""),
            } : null}
          />
        )}
      </section>
    </main>
  );
}

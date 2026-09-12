import { randomUUID } from "crypto";
import { notFound } from "next/navigation";
import { CajaSidebar } from "@/components/CajaSidebar";
import { Badge } from "@/components/Badge";
import { requireModuleAccess } from "@/lib/auth";
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

export default async function AtencionReservadaPage({
  params,
}: {
  params: Promise<{ movimiento_id: string }>;
}) {
  const session = await requireModuleAccess("citas-hoy");
  const movimientoId = (await params).movimiento_id;
  const movimientoResult = await supabaseSelectWhere<Row>(
    "caja_movimientos",
    `select=movimiento_id,source_id,tipo_movimiento,estado,cliente_id,cliente,whatsapp,n_pax,servicio,sede,total_cobrar,total_pagado,pendiente,estado_boleta,tipo_comprobante,estado_comprobante_manual&movimiento_id=eq.${encodeURIComponent(movimientoId)}&limit=1`
  );
  const movimiento = movimientoResult.data[0];
  if (!movimiento) notFound();

  const reservaId = String(movimiento.source_id ?? "");
  const [reservaResult, detallesResult, configResult] = await Promise.all([
    supabaseSelectWhere<Row>(
      "citas_reservadas",
      `select=reserva_id,source_id,cliente_id,estado,estado_ficha,requiere_confirmacion,confirmado_en,atencion_personalizada,tipo_atencion&reserva_id=eq.${encodeURIComponent(reservaId)}&limit=1`
    ),
    supabaseSelectWhere<Row>(
      "caja_atencion_detalle",
      `select=persona_n,terapista,terapista_otro&movimiento_id=eq.${encodeURIComponent(movimientoId)}&order=persona_n.asc`
    ),
    supabaseSelect<Row>("config_listas"),
  ]);
  const reserva = reservaResult.data[0];
  const relacionValida = Boolean(
    reserva && String(reserva.source_id ?? "") === movimientoId &&
    String(reserva.cliente_id ?? "") === String(movimiento.cliente_id ?? "")
  );
  const transicionable = (
    movimiento.tipo_movimiento === "RESERVA_APP" && movimiento.estado === "Reservado" && reserva?.estado === "PENDIENTE"
  ) || (
    movimiento.tipo_movimiento === "ATENCION_APP" && movimiento.estado === "En atención" && reserva?.estado === "EN_ATENCION"
  );
  const confirmacionValida = reserva?.requiere_confirmacion !== true || Boolean(reserva.confirmado_en);

  const terapeutasActuales: Record<number, string> = {};
  for (const detalle of detallesResult.data) {
    const persona = Number(detalle.persona_n);
    const terapeuta = String(detalle.terapista ?? "");
    if (Number.isInteger(persona) && terapeuta && terapeuta !== "Por asignar") terapeutasActuales[persona] = terapeuta;
  }
  const errors = [movimientoResult.error, reservaResult.error, detallesResult.error, configResult.error].filter(Boolean);
  const comprobante = String(
    movimiento.estado_comprobante_manual || movimiento.estado_boleta || movimiento.tipo_comprobante || "No definido"
  );

  return (
    <main className="appShell">
      <CajaSidebar session={session} />
      <section className="page atencionReservadaPage">
        <section className="hero atencionReservadaHero">
          <div>
            <p className="eyebrow">Reserva existente</p>
            <h1>Iniciar atención</h1>
            <p className="subtitle">{String(movimiento.cliente ?? "-")} · {String(movimiento.servicio ?? "-")}</p>
          </div>
          <Badge>{String(movimiento.estado ?? "-")}</Badge>
        </section>

        <section className="atencionReservadaIdentity">
          <div><span>Sede</span><strong>{String(movimiento.sede ?? "-")}</strong></div>
          <div><span>Personas</span><strong>{String(movimiento.n_pax ?? 1)}</strong></div>
          <div><span>Reserva</span><strong>{reservaId}</strong></div>
          <div><span>Movimiento</span><strong>{movimientoId}</strong></div>
          <div><span>Ficha</span><strong>{String(reserva?.estado_ficha ?? "-")}</strong></div>
          <div><span>Adelanto/pagado</span><strong>{money(movimiento.total_pagado)}</strong></div>
        </section>

        {errors.length > 0 && <div className="alert">No se pudo cargar toda la información: {errors.join(" · ")}</div>}
        {!relacionValida || !transicionable || !confirmacionValida ? (
          <section className="panel">
            <div className="alert">
              Esta reserva no es válida para la transición segura. Verifica relación, confirmación y estado antes de continuar.
            </div>
            <a href="/citas-hoy">Volver a Citas de hoy</a>
          </section>
        ) : (
          <AtencionReservadaForm
            requestId={randomUUID()}
            movimientoId={movimientoId}
            reservaId={reservaId}
            personas={Number(movimiento.n_pax ?? 1)}
            total={Number(movimiento.total_cobrar ?? 0)}
            pagado={Number(movimiento.total_pagado ?? 0)}
            pendiente={Number(movimiento.pendiente ?? 0)}
            terapistas={orderedValues(configResult.data, "TERAPISTAS")}
            metodos={orderedValues(configResult.data, "METODOS_PAGO")}
            terapistasActuales={terapeutasActuales}
            comprobante={comprobante}
            estadoActual={movimiento.estado === "En atención" ? "En atención" : "Reservado"}
          />
        )}
      </section>
    </main>
  );
}

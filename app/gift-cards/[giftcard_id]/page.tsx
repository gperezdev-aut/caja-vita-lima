import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { randomUUID } from "crypto";
import { CajaSidebar } from "@/components/CajaSidebar";
import { requireModuleAccess } from "@/lib/auth";
import { formatGiftCardDate, whatsappGiftCardUrl } from "@/lib/giftCards";
import { supabaseSelectWhere } from "@/lib/supabaseServer";
import { anularGiftCardAction, canjearGiftCardAction } from "../actions";

type Row = Record<string, unknown>;
function money(value: unknown) { return `S/ ${Number(value ?? 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

export default async function GiftCardDetailPage({ params }: { params: Promise<{ giftcard_id: string }> }) {
  const session = await requireModuleAccess("gift-cards");
  const { giftcard_id: giftcardId } = await params;
  if (!/^GC-(APP|LEGACY)-[A-Z0-9-]+$/i.test(giftcardId)) notFound();
  const cards = await supabaseSelectWhere<Row>("vista_gift_cards_operativa", `select=*&giftcard_id=eq.${encodeURIComponent(giftcardId)}&limit=1`);
  const card = cards.data[0]; if (!card) notFound();
  const [uses, payments, movements] = await Promise.all([
    supabaseSelectWhere<Row>("gift_card_usos", `select=*&giftcard_id=eq.${encodeURIComponent(giftcardId)}&order=created_at.desc`),
    supabaseSelectWhere<Row>("caja_pagos", `select=*&pago_id=eq.${encodeURIComponent(String(card.pago_id ?? ""))}&limit=1`),
    supabaseSelectWhere<Row>("caja_movimientos", `select=movimiento_id,tipo_movimiento,fecha,hora,sede,total_pagado,source_type,source_id&movimiento_id=eq.${encodeURIComponent(String(card.movimiento_id ?? ""))}&limit=1`),
  ]);
  const status = String(card.estado_efectivo ?? card.estado ?? "EMITIDA"); const code = String(card.codigo ?? "");
  const canRedeem = ["EMITIDA","PARCIALMENTE_USADA"].includes(status); const isAmount = card.tipo === "MONTO";
  const phone = String(card.whatsapp_beneficiario ?? card.whatsapp_comprador ?? "");
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "caja.vitalimaspa.com";
  const protocol = requestHeaders.get("x-forwarded-proto") || "https";
  const siteUrl = String(process.env.NEXT_PUBLIC_SITE_URL || `${protocol}://${host}`).replace(/\/$/, "");
  const shareUrl = whatsappGiftCardUrl(phone, code, `${siteUrl}/gift-cards/${giftcardId}`);
  return <main className="appShell"><CajaSidebar session={session}/><section className="page giftCardDetailPage">
    <div className="giftCardDetailTop"><Link className="ghostButton" href="/gift-cards">← Gift Cards</Link><span className={`giftCardStatus status-${status}`}>{status.replaceAll("_"," ")}</span></div>
    <section className="digitalGiftCard"><Image src="/brand/logo-vita-lima-orange.png" alt="Vita Lima Spa" width={150} height={68}/><p>Un regalo de bienestar para</p><h1>{String(card.destinatario ?? "")}</h1><strong>{isAmount ? money(card.monto) : String(card.service_name_snapshot ?? card.servicio ?? "")}</strong>{!isAmount && <span>{Number(card.service_duration_min ?? 0)} minutos</span>}{card.dedicatoria && <blockquote>{String(card.dedicatoria)}</blockquote>}<code>{code}</code><small>Válida hasta el {formatGiftCardDate(String(card.fecha_vencimiento ?? ""))}</small><p className="giftCardContact">Reservas: vitalimaspa.com · Presenta este código al reservar.</p></section>
    <div className="giftCardDetailActions"><a className="primaryButton" href={`/api/gift-cards/${encodeURIComponent(giftcardId)}/download`}>Descargar Gift Card</a>{phone && <a className="ghostButton" href={shareUrl} target="_blank" rel="noreferrer">Compartir por WhatsApp</a>}</div>
    <section className="giftCardDetailGrid"><div className="panel"><h2>Datos y saldo</h2><dl className="giftCardData"><div><dt>Código</dt><dd>{code}</dd></div><div><dt>Tipo</dt><dd>{String(card.tipo)}</dd></div><div><dt>Comprador</dt><dd>{String(card.comprador ?? "—")}</dd></div><div><dt>Beneficiario</dt><dd>{String(card.destinatario ?? "—")}</dd></div><div><dt>Emitida</dt><dd>{formatGiftCardDate(String(card.fecha_emision ?? ""))}</dd></div><div><dt>Vence</dt><dd>{formatGiftCardDate(String(card.fecha_vencimiento ?? ""))}</dd></div><div><dt>Valor inicial</dt><dd>{money(card.monto)}</dd></div><div><dt>Saldo</dt><dd>{isAmount ? money(card.saldo_restante) : status === "USADA" ? "Usada" : "Uso completo disponible"}</dd></div></dl><details className="technicalDetails"><summary>Movimiento y pago asociados</summary><pre>{JSON.stringify({ movimiento: movements.data[0] ?? null, pago: payments.data[0] ?? null }, null, 2)}</pre></details></div>
      <div className="panel"><h2>Canje</h2>{canRedeem ? <form action={canjearGiftCardAction} className="giftCardActionForm"><input type="hidden" name="request_id" value={randomUUID()}/><input type="hidden" name="codigo" value={code}/>{isAmount && <label>Monto a usar<input name="monto_usado" type="number" min="0.01" max={Number(card.saldo_restante ?? 0)} step="0.01" required/></label>}<details><summary>Relación opcional</summary><label>Movimiento<input name="movimiento_id"/></label><label>Reserva<input name="reserva_id"/></label><label>Atención / movimiento<input name="atencion_movimiento_id"/></label></details><label>Observación<textarea name="observacion" rows={2}/></label><button className="primaryButton" type="submit">CANJEAR GIFT CARD</button></form> : <p>Esta Gift Card no admite canje por su estado actual.</p>}
      {session.rol === "ADMIN_GERALD" && status !== "ANULADA" && status !== "USADA" && <details className="giftCardCancel"><summary>Anular Gift Card</summary><form action={anularGiftCardAction} className="giftCardActionForm"><input type="hidden" name="codigo" value={code}/><label>Motivo<input name="motivo" required/></label><p>Responsable: {session.nombre}. Esta acción no genera devolución automática.</p><button className="dangerButton" type="submit">Confirmar anulación</button></form></details>}</div>
    </section>
    <section className="panel"><h2>Historial de usos</h2>{uses.data.length ? <div className="giftCardUseList">{uses.data.map((use)=><article key={String(use.uso_id)}><strong>{money(use.monto_usado)}</strong><span>{formatGiftCardDate(String(use.fecha_uso))} · {String(use.hora_uso).slice(0,5)}</span><small>{String(use.responsable)}</small>{use.movimiento_id && <code>{String(use.movimiento_id)}</code>}</article>)}</div> : <p>Aún no registra usos.</p>}</section>
  </section></main>;
}

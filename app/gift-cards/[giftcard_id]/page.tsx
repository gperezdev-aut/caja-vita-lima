import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "crypto";
import { CajaSidebar } from "@/components/CajaSidebar";
import { requireModuleAccess } from "@/lib/auth";
import { formatGiftCardDate } from "@/lib/giftCards";
import { normalizeGiftCardPresentationText } from "@/lib/giftCardTemplate";
import { supabaseSelectWhere } from "@/lib/supabaseServer";
import { anularGiftCardAction, canjearGiftCardAction } from "../actions";
import { GiftCardShareButton } from "../GiftCardShareButton";

type Row = Record<string, unknown>;
function money(value: unknown) {
  return `S/ ${Number(value ?? 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function GiftCardDetailPage({
  params,
}: {
  params: Promise<{ giftcard_id: string }>;
}) {
  const session = await requireModuleAccess("gift-cards");
  const { giftcard_id: giftcardId } = await params;
  if (!/^GC-(APP|LEGACY)-[A-Z0-9-]+$/i.test(giftcardId)) notFound();
  const cards = await supabaseSelectWhere<Row>(
    "vista_gift_cards_operativa",
    `select=*&giftcard_id=eq.${encodeURIComponent(giftcardId)}&limit=1`,
  );
  const card = cards.data[0];
  if (!card) notFound();
  const [uses, payments, movements] = await Promise.all([
    supabaseSelectWhere<Row>(
      "gift_card_usos",
      `select=*&giftcard_id=eq.${encodeURIComponent(giftcardId)}&order=created_at.desc`,
    ),
    supabaseSelectWhere<Row>(
      "caja_pagos",
      `select=*&pago_id=eq.${encodeURIComponent(String(card.pago_id ?? ""))}&limit=1`,
    ),
    supabaseSelectWhere<Row>(
      "caja_movimientos",
      `select=movimiento_id,tipo_movimiento,fecha,hora,sede,total_pagado,source_type,source_id&movimiento_id=eq.${encodeURIComponent(String(card.movimiento_id ?? ""))}&limit=1`,
    ),
  ]);
  const status = String(card.estado_efectivo ?? card.estado ?? "EMITIDA");
  const code = String(card.codigo ?? "");
  const canRedeem = ["EMITIDA", "PARCIALMENTE_USADA"].includes(status);
  const isAmount = card.tipo === "MONTO";
  const phone = String(
    card.whatsapp_beneficiario ?? card.whatsapp_comprador ?? "",
  );
  const beneficiary = normalizeGiftCardPresentationText(card.destinatario);
  const buyer = normalizeGiftCardPresentationText(card.comprador);
  return (
    <main className="appShell">
      <CajaSidebar session={session} />
      <section className="page giftCardDetailPage">
        <div className="giftCardDetailTop">
          <Link className="ghostButton" href="/gift-cards">
            ← Gift Cards
          </Link>
          <span className={`giftCardStatus status-${status}`}>
            {status.replaceAll("_", " ")}
          </span>
        </div>
        <section className="digitalGiftCard giftCardTemplatePreview">
          <Image
            unoptimized
            src={`/api/gift-cards/${encodeURIComponent(giftcardId)}/download?preview=1`}
            alt={`Vista previa de la Gift Card ${code} para ${beneficiary}`}
            width={1645}
            height={1379}
          />
        </section>
        <div className="giftCardDetailActions">
          <a
            className="primaryButton"
            href={`/api/gift-cards/${encodeURIComponent(giftcardId)}/download`}
          >
            Descargar Gift Card
          </a>
          {phone && (
            <GiftCardShareButton
              giftcardId={giftcardId}
              code={code}
              phone={phone}
            />
          )}
        </div>
        <section className="giftCardDetailGrid">
          <div className="panel">
            <h2>Datos y saldo</h2>
            <dl className="giftCardData">
              <div>
                <dt>Código</dt>
                <dd>{code}</dd>
              </div>
              <div>
                <dt>Tipo</dt>
                <dd>{String(card.tipo)}</dd>
              </div>
              <div>
                <dt>Comprador</dt>
                <dd>{buyer || "—"}</dd>
              </div>
              <div>
                <dt>Beneficiario</dt>
                <dd>{beneficiary || "—"}</dd>
              </div>
              <div>
                <dt>Emitida</dt>
                <dd>{formatGiftCardDate(String(card.fecha_emision ?? ""))}</dd>
              </div>
              <div>
                <dt>Vence</dt>
                <dd>
                  {formatGiftCardDate(String(card.fecha_vencimiento ?? ""))}
                </dd>
              </div>
              <div>
                <dt>Valor inicial</dt>
                <dd>{money(card.monto)}</dd>
              </div>
              <div>
                <dt>Saldo</dt>
                <dd>
                  {isAmount
                    ? money(card.saldo_restante)
                    : status === "USADA"
                      ? "Usada"
                      : "Uso completo disponible"}
                </dd>
              </div>
            </dl>
            <details className="technicalDetails">
              <summary>Movimiento y pago asociados</summary>
              <pre>
                {JSON.stringify(
                  {
                    movimiento: movements.data[0] ?? null,
                    pago: payments.data[0] ?? null,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </div>
          <div className="panel">
            <h2>Canje</h2>
            {canRedeem ? (
              <form
                action={canjearGiftCardAction}
                className="giftCardActionForm"
              >
                <input type="hidden" name="request_id" value={randomUUID()} />
                <input type="hidden" name="codigo" value={code} />
                {isAmount && (
                  <label>
                    Monto a usar
                    <input
                      name="monto_usado"
                      type="number"
                      min="0.01"
                      max={Number(card.saldo_restante ?? 0)}
                      step="0.01"
                      required
                    />
                  </label>
                )}
                <details>
                  <summary>Relación opcional</summary>
                  <label>
                    Movimiento
                    <input name="movimiento_id" />
                  </label>
                  <label>
                    Reserva
                    <input name="reserva_id" />
                  </label>
                  <label>
                    Atención / movimiento
                    <input name="atencion_movimiento_id" />
                  </label>
                </details>
                <label>
                  Observación
                  <textarea name="observacion" rows={2} />
                </label>
                <button className="primaryButton" type="submit">
                  CANJEAR GIFT CARD
                </button>
              </form>
            ) : (
              <p>Esta Gift Card no admite canje por su estado actual.</p>
            )}
            {session.rol === "ADMIN_GERALD" &&
              status !== "ANULADA" &&
              status !== "USADA" && (
                <details className="giftCardCancel">
                  <summary>Anular Gift Card</summary>
                  <form
                    action={anularGiftCardAction}
                    className="giftCardActionForm"
                  >
                    <input type="hidden" name="codigo" value={code} />
                    <label>
                      Motivo
                      <input name="motivo" required />
                    </label>
                    <p>
                      Responsable: {session.nombre}. Esta acción no genera
                      devolución automática.
                    </p>
                    <button className="dangerButton" type="submit">
                      Confirmar anulación
                    </button>
                  </form>
                </details>
              )}
          </div>
        </section>
        <section className="panel">
          <h2>Historial de usos</h2>
          {uses.data.length ? (
            <div className="giftCardUseList">
              {uses.data.map((use) => (
                <article key={String(use.uso_id)}>
                  <strong>{money(use.monto_usado)}</strong>
                  <span>
                    {formatGiftCardDate(String(use.fecha_uso))} ·{" "}
                    {String(use.hora_uso).slice(0, 5)}
                  </span>
                  <small>{String(use.responsable)}</small>
                  {use.movimiento_id && (
                    <code>{String(use.movimiento_id)}</code>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p>Aún no registra usos.</p>
          )}
        </section>
      </section>
    </main>
  );
}

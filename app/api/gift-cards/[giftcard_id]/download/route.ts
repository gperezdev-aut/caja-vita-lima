import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/auth";
import { formatGiftCardDate } from "@/lib/giftCards";
import { supabaseSelectWhere } from "@/lib/supabaseServer";

type Row = Record<string, unknown>;
function escapeXml(value: unknown) { return String(value ?? "").replace(/[<>&"']/g, (character) => ({ "<":"&lt;", ">":"&gt;", "&":"&amp;", '"':"&quot;", "'":"&apos;" })[character] || character); }
function money(value: unknown) { return `S/ ${Number(value ?? 0).toFixed(2)}`; }

export async function GET(_request: Request, { params }: { params: Promise<{ giftcard_id: string }> }) {
  await requireModuleAccess("gift-cards");
  const { giftcard_id: giftcardId } = await params;
  if (!/^GC-(APP|LEGACY)-[A-Z0-9-]+$/i.test(giftcardId)) return new NextResponse("No encontrada", { status: 404 });
  const result = await supabaseSelectWhere<Row>("vista_gift_cards_operativa", `select=giftcard_id,codigo,destinatario,tipo,service_name_snapshot,service_duration_min,monto,dedicatoria,fecha_vencimiento&giftcard_id=eq.${encodeURIComponent(giftcardId)}&limit=1`);
  const card = result.data[0]; if (!card) return new NextResponse("No encontrada", { status: 404 });
  const logo = await readFile(join(process.cwd(), "public/brand/logo-vita-lima-orange.png"));
  const mainGift = card.tipo === "MONTO" ? money(card.monto) : String(card.service_name_snapshot ?? "");
  const duration = card.tipo === "SERVICIO" ? `${Number(card.service_duration_min ?? 0)} minutos` : "Saldo para servicios Vita Lima";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"><rect width="1600" height="1000" fill="#fffaf1"/><rect x="42" y="42" width="1516" height="916" rx="52" fill="none" stroke="#c9a66b" stroke-width="4"/><circle cx="1430" cy="150" r="180" fill="#f18e17" opacity=".10"/><image href="data:image/png;base64,${logo.toString("base64")}" x="625" y="90" width="350" height="158" preserveAspectRatio="xMidYMid meet"/><text x="800" y="315" text-anchor="middle" font-family="Georgia,serif" font-size="34" fill="#6f665c">Un regalo de bienestar para</text><text x="800" y="405" text-anchor="middle" font-family="Georgia,serif" font-size="68" font-weight="700" fill="#26231f">${escapeXml(card.destinatario)}</text><text x="800" y="520" text-anchor="middle" font-family="Arial,sans-serif" font-size="48" font-weight="700" fill="#f18e17">${escapeXml(mainGift)}</text><text x="800" y="575" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" fill="#6f665c">${escapeXml(duration)}</text>${card.dedicatoria ? `<text x="800" y="665" text-anchor="middle" font-family="Georgia,serif" font-style="italic" font-size="28" fill="#26231f">${escapeXml(String(card.dedicatoria).slice(0,90))}</text>` : ""}<rect x="530" y="725" width="540" height="76" rx="20" fill="#26231f"/><text x="800" y="775" text-anchor="middle" font-family="monospace" font-size="35" font-weight="700" fill="#fffaf1">${escapeXml(card.codigo)}</text><text x="800" y="855" text-anchor="middle" font-family="Arial,sans-serif" font-size="25" fill="#6f665c">Válida hasta el ${escapeXml(formatGiftCardDate(String(card.fecha_vencimiento ?? "")))}</text><text x="800" y="905" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" fill="#6f665c">Reservas: vitalimaspa.com · Presenta el código al reservar</text></svg>`;
  return new NextResponse(svg, { headers: { "Content-Type":"image/svg+xml; charset=utf-8", "Content-Disposition":`attachment; filename="gift-card-${escapeXml(card.codigo)}.svg"`, "Cache-Control":"private, no-store", "X-Content-Type-Options":"nosniff" } });
}

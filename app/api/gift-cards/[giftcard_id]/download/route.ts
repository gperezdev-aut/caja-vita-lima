import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/auth";
import { renderGiftCardSvg } from "@/lib/giftCardTemplate";
import { supabaseSelectWhere } from "@/lib/supabaseServer";

type Row = Record<string, unknown>;
const unzip = promisify(gunzip);

export async function GET(request: Request, { params }: { params: Promise<{ giftcard_id: string }> }) {
  await requireModuleAccess("gift-cards");
  const { giftcard_id: giftcardId } = await params;
  if (!/^GC-(APP|LEGACY)-[A-Z0-9-]+$/i.test(giftcardId)) return new NextResponse("No encontrada", { status: 404 });
  const result = await supabaseSelectWhere<Row>("vista_gift_cards_operativa", `select=codigo,destinatario,tipo,service_name_snapshot,service_duration_min,monto,dedicatoria,fecha_vencimiento&giftcard_id=eq.${encodeURIComponent(giftcardId)}&limit=1`);
  const card = result.data[0]; if (!card) return new NextResponse("No encontrada", { status: 404 });
  const compressedTemplate = await readFile(join(process.cwd(), "public/gift-cards/gift-card-template-vita-lima.png.gz"));
  const template = await unzip(compressedTemplate);
  const code = String(card.codigo ?? "");
  const svg = renderGiftCardSvg({
    code,
    beneficiary: String(card.destinatario ?? ""),
    type: card.tipo === "MONTO" ? "MONTO" : "SERVICIO",
    serviceName: String(card.service_name_snapshot ?? ""),
    durationMinutes: Number(card.service_duration_min ?? 0),
    amount: Number(card.monto ?? 0),
    dedication: String(card.dedicatoria ?? ""),
    expirationDate: String(card.fecha_vencimiento ?? ""),
  }, template.toString("base64"));
  const disposition = new URL(request.url).searchParams.get("preview") === "1" ? "inline" : "attachment";
  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Content-Disposition": `${disposition}; filename="gift-card-${code}.svg"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/auth";
import { readCanonicalCatalog } from "@/lib/catalogoCanonicoServer";
import {
  renderGiftCardSvg,
  splitGiftCardServiceName,
} from "@/lib/giftCardTemplate";
import { renderGiftCardPng } from "@/lib/giftCardPng";
import { supabaseSelectWhere } from "@/lib/supabaseServer";

type Row = Record<string, unknown>;
const unzip = promisify(gunzip);

function catalogIdentifier(value: unknown) {
  const identifier = String(value ?? "").trim();
  return /^[A-Za-z0-9._-]{1,100}$/.test(identifier) ? identifier : "";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ giftcard_id: string }> },
) {
  await requireModuleAccess("gift-cards");
  const { giftcard_id: giftcardId } = await params;
  if (!/^GC-(APP|LEGACY)-[A-Z0-9-]+$/i.test(giftcardId))
    return new NextResponse("No encontrada", { status: 404 });
  const result = await supabaseSelectWhere<Row>(
    "vista_gift_cards_operativa",
    `select=codigo,destinatario,tipo,service_code,service_name_snapshot,service_duration_min,catalog_release_id,catalog_price_version,monto,dedicatoria,fecha_vencimiento&giftcard_id=eq.${encodeURIComponent(giftcardId)}&limit=1`,
  );
  const card = result.data[0];
  if (!card) return new NextResponse("No encontrada", { status: 404 });
  const serviceCode = catalogIdentifier(card.service_code);
  const releaseId = catalogIdentifier(card.catalog_release_id);
  const priceVersion = catalogIdentifier(card.catalog_price_version);
  let serviceDescription = "";
  if (card.tipo === "SERVICIO" && serviceCode && releaseId && priceVersion) {
    try {
      const catalog = await readCanonicalCatalog();
      const versionedService = catalog.services?.find(
        (service) =>
          service.service_code === serviceCode &&
          service.release_id === releaseId &&
          service.price_version === priceVersion,
      );
      serviceDescription = versionedService?.included_es ?? "";
    } catch {
      serviceDescription = "";
    }
  }
  const compressedTemplate = await readFile(
    join(
      process.cwd(),
      "public/gift-cards/gift-card-template-vita-lima.png.gz",
    ),
  );
  const template = await unzip(compressedTemplate);
  const code = String(card.codigo ?? "");
  const emojiKey = splitGiftCardServiceName(
    card.service_name_snapshot,
  ).emojiKey;
  let serviceEmojiBase64 = "";
  if (/^[a-f0-9-]{2,80}$/.test(emojiKey)) {
    try {
      serviceEmojiBase64 = (
        await readFile(
          join(process.cwd(), "public/gift-cards/emoji", `${emojiKey}.png`),
        )
      ).toString("base64");
    } catch {
      serviceEmojiBase64 = "";
    }
  }
  const svg = renderGiftCardSvg(
    {
      code,
      beneficiary: String(card.destinatario ?? ""),
      type: card.tipo === "MONTO" ? "MONTO" : "SERVICIO",
      serviceName: String(card.service_name_snapshot ?? ""),
      serviceDescription,
      serviceEmojiBase64,
      durationMinutes: Number(card.service_duration_min ?? 0),
      amount: Number(card.monto ?? 0),
      dedication: String(card.dedicatoria ?? ""),
      expirationDate: String(card.fecha_vencimiento ?? ""),
    },
    template.toString("base64"),
  );
  const disposition =
    new URL(request.url).searchParams.get("preview") === "1"
      ? "inline"
      : "attachment";
  const png = renderGiftCardPng(svg);
  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `${disposition}; filename="gift-card-${code}.png"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

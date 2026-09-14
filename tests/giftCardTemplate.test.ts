import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";
import { gunzip } from "node:zlib";
import {
  fitGiftCardText,
  normalizeGiftCardPresentationText,
  renderGiftCardSvg,
  splitGiftCardServiceName,
} from "../lib/giftCardTemplate.ts";
import { renderGiftCardPng } from "../lib/giftCardPng.ts";
import { whatsappGiftCardUrl } from "../lib/giftCards.ts";

const root = process.cwd();
const source = (path: string) => readFile(`${root}/${path}`, "utf8");
const unzip = promisify(gunzip);

test("el molde real conserva su archivo original y dimensiones", async () => {
  const compressed = await readFile(
    `${root}/public/gift-cards/gift-card-template-vita-lima.png.gz`,
  );
  const png = await unzip(compressed);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 1645);
  assert.equal(png.readUInt32BE(20), 1379);
});

test("descarga por servicio renderiza fecha, código, beneficiario, incluidos, duración y dedicatoria", () => {
  const svg = renderGiftCardSvg(
    {
      code: "GC-VITA-A1B2C3D4",
      beneficiary: "María Peña",
      type: "SERVICIO",
      serviceName: "✨ Masaje relajante",
      serviceDescription: "Masaje relajante + reflexología y aromaterapia",
      durationMinutes: 65,
      amount: 120,
      dedication: "Disfruta tu día",
      expirationDate: "2027-06-15",
    },
    "VEVNUExBVEU=",
  );

  assert.match(svg, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(svg, /<svg[\s\S]*<\/svg>$/);
  assert.match(svg, /data:image\/png;base64,VEVNUExBVEU=/);
  assert.match(svg, /EXPIRA: 15\/06\/2027/);
  assert.match(svg, /CÓDIGO: GC-VITA-A1B2C3D4/);
  assert.match(svg, /MARÍA PEÑA/);
  assert.match(svg, /✨ MASAJE RELAJANTE/);
  assert.match(svg, /Masaje relajante \+ reflexología y aromaterapia/);
  assert.match(svg, /65 MINUTOS/);
  assert.match(svg, /“Disfruta tu día”/);
  assert.match(svg, /font-size="56" font-weight="600"/);
  assert.match(svg, /font-size="54" font-weight="600"/);
  assert.match(svg, /font-size="44" font-weight="600"/);
});

test("descarga por monto usa el importe, omite duración y omite dedicatoria vacía", () => {
  const svg = renderGiftCardSvg(
    {
      code: "GC-VITA-1234ABCD",
      beneficiary: "José Núñez",
      type: "MONTO",
      amount: 150,
      dedication: "   ",
      expirationDate: "2027-09-13",
    },
    "VEVNUExBVEU=",
  );

  assert.match(svg, /GIFT CARD POR S\/ 150\.00/);
  assert.match(svg, /font-size="60" font-weight="600"/);
  assert.match(svg, /JOSÉ NÚÑEZ/);
  assert.doesNotMatch(svg, /MINUTOS/);
  assert.doesNotMatch(svg, /font-style="italic"/);
});

test("normalización visual repara mojibake y preserva UTF-8 válido", () => {
  assert.equal(
    normalizeGiftCardPresentationText("âœ¨ Facial Glow Premium"),
    "✨ Facial Glow Premium",
  );
  assert.equal(
    normalizeGiftCardPresentationText("Masaje para mamÃ¡"),
    "Masaje para mamá",
  );
  assert.equal(normalizeGiftCardPresentationText("ðŸ‘‘ Royale"), "👑 Royale");
  assert.equal(normalizeGiftCardPresentationText("Ã¢Å“Â¨ Facial"), "✨ Facial");
  assert.equal(
    normalizeGiftCardPresentationText("Niñez, armonía y ✨"),
    "Niñez, armonía y ✨",
  );
});

test("emoji inicial conserva su grafema y se convierte en recurso embebido para PNG", async () => {
  assert.deepEqual(splitGiftCardServiceName("ðŸ‘‘ Royale"), {
    emoji: "👑",
    emojiKey: "1f451",
    label: "Royale",
  });
  const emoji = await readFile(`${root}/public/gift-cards/emoji/1f451.png`);
  const svg = renderGiftCardSvg(
    {
      code: "GC-VITA-EMOJI001",
      beneficiary: "María",
      type: "SERVICIO",
      serviceName: "ðŸ‘‘ Royale",
      serviceEmojiBase64: emoji.toString("base64"),
      durationMinutes: 90,
      amount: 180,
      expirationDate: "2027-09-13",
    },
    "VEVNUExBVEU=",
  );
  assert.match(svg, /data:image\/png;base64,/);
  assert.match(svg, />ROYALE</);
  assert.doesNotMatch(svg, /ðŸ|👑 ROYALE/);
});

test("textos razonablemente largos se ajustan sin elipsis ni invasión de zonas fijas", () => {
  const beneficiary = fitGiftCardText(
    "María Fernanda de los Ángeles Rodríguez Peña y José Antonio Núñez Salazar",
    { baseCharacters: 25, maxLines: 3, baseFontSize: 56, minFontSize: 34 },
  );
  const service = fitGiftCardText(
    "Ritual relajante premium de cuerpo completo para recuperación profunda",
    { baseCharacters: 28, maxLines: 3, baseFontSize: 54, minFontSize: 30 },
  );
  const description = fitGiftCardText(
    "Masaje relajante de cuerpo completo, reflexología, aromaterapia, piedras calientes y una pausa final de respiración consciente.",
    { baseCharacters: 44, maxLines: 4, baseFontSize: 30, minFontSize: 20 },
  );
  const dedication = fitGiftCardText(
    "Con mucho cariño para que disfrutes una pausa especial, recuperes energía y recuerdes cuánto te queremos en este día tan importante.",
    { baseCharacters: 50, maxLines: 3, baseFontSize: 27, minFontSize: 18 },
  );
  assert.ok(beneficiary.lines.length <= 3);
  assert.ok(service.lines.length <= 3);
  assert.ok(description.lines.length <= 4);
  assert.ok(dedication.lines.length <= 3);
  assert.doesNotMatch(
    [beneficiary, service, description, dedication]
      .flatMap((layout) => layout.lines)
      .join(" "),
    /…/,
  );
});

test("la descarga usa incluidos solo con match exacto del snapshot local y conserva autenticación", async () => {
  const route = await source(
    "app/api/gift-cards/[giftcard_id]/download/route.ts",
  );
  const svg = renderGiftCardSvg(
    {
      code: "GC-VITA-ABCDEF12",
      beneficiary: "Cliente",
      type: "MONTO",
      amount: 100,
      expirationDate: "2027-09-13",
    },
    "VEVNUExBVEU=",
  );

  assert.match(route, /await requireModuleAccess\("gift-cards"\)/);
  assert.match(route, /Content-Disposition/);
  assert.match(route, /"Content-Type": "image\/png"/);
  assert.match(route, /filename="gift-card-\$\{code\}\.png"/);
  assert.match(route, /private, no-store/);
  assert.match(route, /"caja_catalog_services"/);
  assert.match(route, /select=included_es/);
  assert.match(route, /service_code=eq\.\$\{encodeURIComponent\(serviceCode\)\}/);
  assert.match(route, /release_id=eq\.\$\{encodeURIComponent\(releaseId\)\}/);
  assert.match(route, /price_version=eq\.\$\{encodeURIComponent\(priceVersion\)\}/);
  assert.doesNotMatch(route, /readCanonicalCatalog/);
  assert.doesNotMatch(
    svg,
    /giftcard_id|request_id|movimiento_id|release_id|price_version|pago_id/,
  );
});

test("PNG final es válido, conserva 1645 × 1379 y usa el mismo SVG del preview", async () => {
  const compressed = await readFile(
    `${root}/public/gift-cards/gift-card-template-vita-lima.png.gz`,
  );
  const template = await unzip(compressed);
  const svg = renderGiftCardSvg(
    {
      code: "GC-VITA-PNG00001",
      beneficiary: "María Peña",
      type: "SERVICIO",
      serviceName: "👑 Royale",
      serviceDescription: "Masaje + piedras calientes + reflexología",
      durationMinutes: 90,
      amount: 180,
      expirationDate: "2027-09-13",
    },
    template.toString("base64"),
  );
  const png = renderGiftCardPng(svg);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 1645);
  assert.equal(png.readUInt32BE(20), 1379);
});

test("Docker instala DejaVu y bloquea el build si Resvg no pinta texto", async () => {
  const [dockerfile, packageJson] = await Promise.all([
    source("Dockerfile"),
    source("package.json"),
  ]);
  assert.match(dockerfile, /apk add --no-cache libc6-compat font-dejavu/);
  assert.match(dockerfile, /apk add --no-cache font-dejavu/);
  assert.match(dockerfile, /RUN npm run test:gift-card-render/);
  assert.match(packageJson, /"test:gift-card-render"/);
});

test("WhatsApp prepara el mensaje sin publicar un enlace interno de Caja", () => {
  const url = whatsappGiftCardUrl("+51 987 654 321", "GC-VITA-A1B2C3D4");
  const message = new URL(url).searchParams.get("text") ?? "";
  assert.match(url, /^https:\/\/wa\.me\/51987654321\?text=/);
  assert.doesNotMatch(message, /https?:\/\/|\/gift-cards\//);
  assert.match(message, /Te enviamos el archivo a continuación/);
});

test("Gift Cards consume el catálogo canónico completo sin filtro adicional", async () => {
  const page = await source("app/gift-cards/page.tsx");
  const giftCardsModule = await source("app/gift-cards/GiftCardsModule.tsx");
  assert.match(page, /catalog\.services\s*\.map/);
  assert.doesNotMatch(page, /catalog\.services\.filter/);
  assert.match(giftCardsModule, /serviceMatches\.results\.map/);
});

test("el wizard conserva cuatro pasos y una única persistencia final", async () => {
  const wizard = await source("app/gift-cards/GiftCardsModule.tsx");
  assert.match(
    wizard,
    /const steps = \["Personas", "Regalo", "Pago", "Confirmar"\]/,
  );
  assert.equal((wizard.match(/type="submit"/g) ?? []).length, 1);
  assert.match(wizard, /EMITIR GIFT CARD/);
  assert.match(wizard, /step === 3/);
});

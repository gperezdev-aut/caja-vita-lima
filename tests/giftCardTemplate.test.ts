import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";
import { gunzip } from "node:zlib";
import {
  estimateGiftCardTextWidth,
  fitGiftCardText,
  normalizeGiftCardPresentationText,
  renderGiftCardSvg,
  splitGiftCardServiceName,
} from "../lib/giftCardTemplate.ts";
import {
  GIFT_CARD_DESCRIPTION_FALLBACK,
  resolveGiftCardServiceDescription,
} from "../lib/giftCardCatalog.ts";
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

test("descarga por servicio renderiza fecha, código, beneficiario, duración y dedicatoria", () => {
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
  assert.match(svg, /Masaje relajante \+ reflexología y/);
  assert.match(svg, /aromaterapia/);
  assert.match(svg, /65 MINUTOS/);
  assert.match(svg, /“Disfruta tu día”/);
  assert.match(svg, /data-section="beneficiary"[^>]*font-size="70"/);
  assert.match(svg, /data-section="service"[^>]*font-size="63"/);
  assert.match(svg, /data-section="description"[^>]*font-size="32"/);
  assert.match(svg, /data-section="duration"[^>]*font-size="42"/);
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
  assert.match(svg, /JOSÉ NÚÑEZ/);
  assert.doesNotMatch(svg, /MINUTOS/);
  assert.doesNotMatch(svg, /font-style="italic"/);
  assert.doesNotMatch(svg, /INCLUYE/);
});

test("servicio histórico usa included_es solo con coincidencia exacta de sus tres identificadores", () => {
  const identity = {
    serviceCode: "SVC_047",
    releaseId: "catalog-v1-web-4104385",
    priceVersion: "catalog-v1-web-4104385",
  };
  const rows = [
    {
      service_code: "SVC_047",
      release_id: "catalog-v1-web-4104385",
      price_version: "catalog-v1-web-4104385",
      included_es: "Limpieza + exfoliación + mascarilla de colágeno + luz LED",
    },
  ];

  assert.equal(
    resolveGiftCardServiceDescription(identity, rows),
    rows[0].included_es,
  );
  assert.equal(
    resolveGiftCardServiceDescription(
      { ...identity, serviceCode: "SVC_999" },
      rows,
    ),
    GIFT_CARD_DESCRIPTION_FALLBACK,
  );
  assert.equal(
    resolveGiftCardServiceDescription(
      { ...identity, releaseId: "otro-release" },
      rows,
    ),
    GIFT_CARD_DESCRIPTION_FALLBACK,
  );
  assert.equal(
    resolveGiftCardServiceDescription(
      { ...identity, priceVersion: "otra-version" },
      rows,
    ),
    GIFT_CARD_DESCRIPTION_FALLBACK,
  );
  assert.equal(
    resolveGiftCardServiceDescription(identity, [
      { ...rows[0], included_es: null },
    ]),
    GIFT_CARD_DESCRIPTION_FALLBACK,
  );
  assert.equal(
    resolveGiftCardServiceDescription(identity, [
      { ...rows[0], included_es: "   " },
    ]),
    GIFT_CARD_DESCRIPTION_FALLBACK,
  );
  assert.equal(
    resolveGiftCardServiceDescription(identity, [rows[0], { ...rows[0] }]),
    GIFT_CARD_DESCRIPTION_FALLBACK,
  );
  assert.equal(
    resolveGiftCardServiceDescription(identity, []),
    GIFT_CARD_DESCRIPTION_FALLBACK,
  );
});

test("composición amplia conserva textos largos completos, tildes, ñ y emoji", () => {
  const beneficiary =
    "María Fernanda de los Ángeles Rodríguez Peña y José Núñez";
  const serviceName = "✨ Experiencia Renacer Premium para dos personas";
  const serviceDescription =
    "Masaje relajante y descontracturante + piedras calientes + exfoliación de espalda + mascarilla de ácido hialurónico + reflexología podal + hidratación corporal + aromaterapia con vela de soja artesanal + copa de vino o infusión";
  const dedication =
    "Con muchísimo cariño para que disfrutes esta pausa, renueves tu energía y recuerdes lo especial que eres para nosotros.";
  const svg = renderGiftCardSvg(
    {
      code: "GC-VITA-LARGO001",
      beneficiary,
      type: "SERVICIO",
      serviceName,
      serviceDescription,
      durationMinutes: 120,
      amount: 280,
      dedication,
      expirationDate: "2027-09-13",
    },
    "VEVNUExBVEU=",
  );

  for (const word of [
    "MARÍA",
    "NÚÑEZ",
    "EXPERIENCIA",
    "ácido",
    "aromaterapia",
    "muchísimo",
    "120 MINUTOS",
  ]) {
    assert.match(svg, new RegExp(word));
  }
  assert.match(svg, /INCLUYE/);
  assert.doesNotMatch(svg, /…/);
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
    { baseCharacters: 29, maxLines: 3, baseFontSize: 48, minFontSize: 28 },
  );
  const dedication = fitGiftCardText(
    "Con mucho cariño para que disfrutes una pausa especial, recuperes energía y recuerdes cuánto te queremos en este día tan importante.",
    { baseCharacters: 48, maxLines: 4, baseFontSize: 27, minFontSize: 18 },
  );
  assert.ok(beneficiary.lines.length <= 3);
  assert.ok(dedication.lines.length <= 4);
  assert.doesNotMatch(beneficiary.lines.join(" "), /…/);
  assert.doesNotMatch(dedication.lines.join(" "), /…/);
});

test("el fitting por ancho conserva máximos y reduce solo los glifos que no caben", () => {
  const beneficiary = fitGiftCardText(
    "MARÍA FERNANDA DE LOS ÁNGELES RODRÍGUEZ PEÑA Y JOSÉ NÚÑEZ SALAZAR",
    {
      baseCharacters: 22,
      maxLines: 3,
      baseFontSize: 70,
      minFontSize: 38,
      maxWidth: 850,
    },
  );
  const service = fitGiftCardText(
    "EXPERIENCIA RENACER PREMIUM PARA DOS PERSONAS",
    {
      baseCharacters: 24,
      maxLines: 3,
      baseFontSize: 63,
      minFontSize: 34,
      maxWidth: 850,
    },
  );
  const short = fitGiftCardText("GLOW FACIAL", {
    baseCharacters: 24,
    maxLines: 3,
    baseFontSize: 63,
    minFontSize: 34,
    maxWidth: 850,
  });

  assert.equal(beneficiary.fontSize, 54);
  assert.equal(service.fontSize, 63);
  assert.equal(short.fontSize, 63);
  for (const layout of [beneficiary, service, short]) {
    for (const line of layout.lines) {
      assert.ok(estimateGiftCardTextWidth(line, layout.fontSize) <= 850);
    }
  }
});

test("la descarga no expone identificadores internos y conserva autenticación", async () => {
  const [route, catalogMigration] = await Promise.all([
    source("app/api/gift-cards/[giftcard_id]/download/route.ts"),
    source("sql/026_gift_card_catalog_history_read.sql"),
  ]);
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
  assert.match(route, /supabaseRpc<Row\[]>/);
  assert.match(route, /"caja_gift_card_catalog_history_read_v1"/);
  assert.match(route, /p_service_code: serviceCode/);
  assert.match(route, /p_release_id: releaseId/);
  assert.match(route, /p_price_version: priceVersion/);
  assert.match(route, /resolveGiftCardServiceDescription/);
  assert.match(catalogMigration, /language sql\s+stable\s+security definer/i);
  assert.match(catalogMigration, /from public\.caja_catalog_services s/i);
  assert.match(catalogMigration, /s\.service_code = p_service_code/i);
  assert.match(catalogMigration, /s\.release_id = p_release_id/i);
  assert.match(catalogMigration, /s\.price_version = p_price_version/i);
  assert.match(catalogMigration, /limit 2/i);
  assert.match(
    catalogMigration,
    /grant execute on function public\.caja_gift_card_catalog_history_read_v1\(text, text, text\)\s+to service_role/i,
  );
  assert.doesNotMatch(
    svg,
    /giftcard_id|request_id|movimiento_id|release_id|price_version|pago_id/,
  );
});

test("Ver y Descargar Gift Card consumen el mismo endpoint PNG", async () => {
  const detail = await source("app/gift-cards/[giftcard_id]/page.tsx");
  assert.match(
    detail,
    /src={`\/api\/gift-cards\/\$\{encodeURIComponent\(giftcardId\)\}\/download\?preview=1`}/,
  );
  assert.match(
    detail,
    /href={`\/api\/gift-cards\/\$\{encodeURIComponent\(giftcardId\)\}\/download`}/,
  );
  assert.match(detail, /<Image/);
  assert.doesNotMatch(detail, /renderGiftCardSvg|renderGiftCardPng/);
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

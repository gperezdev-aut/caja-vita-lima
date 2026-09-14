import { readFile, writeFile } from "node:fs/promises";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { renderGiftCardPng } from "../lib/giftCardPng.ts";
import { renderGiftCardSvg } from "../lib/giftCardTemplate.ts";

const unzip = promisify(gunzip);
const output = process.argv[2] ?? "gift-card-production-qa.png";
const compressed = await readFile(
  "public/gift-cards/gift-card-template-vita-lima.png.gz",
);
const template = await unzip(compressed);
const serviceEmoji = await readFile("public/gift-cards/emoji/2728.png");
const svg = renderGiftCardSvg(
  {
    code: "GC-VITA-TEST1234",
    beneficiary: "SANDRA MEJIA",
    type: "SERVICIO",
    serviceName: "✨ EXPERIENCIA RENACER PREMIUM",
    serviceEmojiBase64: serviceEmoji.toString("base64"),
    serviceDescription:
      "Masaje relajante + piedras calientes + exfoliación de espalda + mascarilla de ácido hialurónico + reflexología podal + aromaterapia",
    durationMinutes: 120,
    amount: 280,
    dedication: "Para que disfrutes una pausa muy especial",
    expirationDate: "2027-09-13",
  },
  template.toString("base64"),
);

const png = renderGiftCardPng(svg);
await writeFile(output, png);
console.log(`PNG QA: ${output} (${png.length} bytes, 1645x1379)`);

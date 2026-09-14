import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { renderGiftCardPng } from "../lib/giftCardPng.ts";
import {
  renderGiftCardSvg,
  type GiftCardTemplateData,
} from "../lib/giftCardTemplate.ts";

const unzip = promisify(gunzip);
const outputDirectory = resolve(
  process.argv[2] ?? join(tmpdir(), "caja-vita-lima-gift-card-png-qa"),
);
await mkdir(outputDirectory, { recursive: true });

const compressed = await readFile(
  "public/gift-cards/gift-card-template-vita-lima.png.gz",
);
const template = (await unzip(compressed)).toString("base64");
const serviceEmojiBase64 = (
  await readFile("public/gift-cards/emoji/2728.png")
).toString("base64");

const common = {
  expirationDate: "2027-09-13",
  serviceEmojiBase64,
};
const scenarios: Array<{ file: string; data: GiftCardTemplateData }> = [
  {
    file: "a-servicio-corto.png",
    data: {
      ...common,
      code: "GC-VITA-0B1972E1",
      beneficiary: "SANDRA",
      type: "SERVICIO",
      serviceName: "✨ Facial Glow Premium",
      serviceDescription:
        "Limpieza + exfoliación + mascarilla de colágeno + luz LED",
      durationMinutes: 50,
      amount: 110,
      dedication: "",
    },
  },
  {
    file: "b-descripcion-extensa.png",
    data: {
      ...common,
      code: "GC-VITA-LARGO001",
      beneficiary: "Sandra Mejía",
      type: "SERVICIO",
      serviceName: "✨ Experiencia Renacer Premium",
      serviceDescription:
        "Masaje relajante y descontracturante de cuerpo completo + piedras calientes + exfoliación de espalda + mascarilla de ácido hialurónico + reflexología podal + hidratación corporal + aromaterapia con vela de soja artesanal + descanso con infusión",
      durationMinutes: 120,
      amount: 280,
      dedication: "",
    },
  },
  {
    file: "c-beneficiario-largo.png",
    data: {
      ...common,
      code: "GC-VITA-NOMBRE01",
      beneficiary:
        "María Fernanda de los Ángeles Rodríguez Peña y José Núñez Salazar",
      type: "SERVICIO",
      serviceName: "✨ Armonía",
      serviceDescription: "Masaje relajante + aromaterapia",
      durationMinutes: 60,
      amount: 100,
      dedication: "",
    },
  },
  {
    file: "d-dedicatoria-larga.png",
    data: {
      ...common,
      code: "GC-VITA-DEDICA01",
      beneficiary: "José Núñez",
      type: "SERVICIO",
      serviceName: "✨ Armonía",
      serviceDescription: "Masaje relajante + aromaterapia",
      durationMinutes: 60,
      amount: 100,
      dedication:
        "Con muchísimo cariño para que disfrutes una pausa especial, recuperes energía y recuerdes cuánto te queremos en este día tan importante.",
    },
  },
  {
    file: "e-monto.png",
    data: {
      code: "GC-VITA-MONTO001",
      beneficiary: "Sandra Mejía",
      type: "MONTO",
      amount: 250,
      dedication: "Que disfrutes tu regalo 🎁",
      expirationDate: "2027-09-13",
    },
  },
];

for (const scenario of scenarios) {
  const png = renderGiftCardPng(renderGiftCardSvg(scenario.data, template));
  if (png.readUInt32BE(16) !== 1645 || png.readUInt32BE(20) !== 1379) {
    throw new Error(`Dimensiones inválidas en ${scenario.file}`);
  }
  const output = join(outputDirectory, scenario.file);
  await writeFile(output, png);
  console.log(`PNG QA: ${output} (${png.length} bytes, 1645x1379)`);
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { gunzipSync, inflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";
import { renderGiftCardPng } from "../lib/giftCardPng.ts";
import { renderGiftCardSvg } from "../lib/giftCardTemplate.ts";

type DecodedPng = { width: number; height: number; pixels: Uint8Array };

function paeth(left: number, above: number, upperLeft: number) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance)
    return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function decodeRgbaPng(png: Uint8Array): DecodedPng {
  const buffer = Buffer.from(png);
  const idat: Buffer[] = [];
  let width = 0;
  let height = 0;
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, "La prueba espera PNG de 8 bits");
      assert.equal(data[9], 6, "La prueba espera PNG RGBA");
    }
    if (type === "IDAT") idat.push(data);
    offset += length + 12;
  }
  const compressed = Buffer.concat(idat);
  const scanlines = inflateSync(compressed);
  const stride = width * 4;
  const pixels = new Uint8Array(stride * height);
  let input = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = scanlines[input++];
    for (let x = 0; x < stride; x += 1) {
      const raw = scanlines[input++];
      const index = y * stride + x;
      const left = x >= 4 ? pixels[index - 4] : 0;
      const above = y > 0 ? pixels[index - stride] : 0;
      const upperLeft = y > 0 && x >= 4 ? pixels[index - stride - 4] : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? above
              : filter === 3
                ? Math.floor((left + above) / 2)
                : paeth(left, above, upperLeft);
      assert.ok(filter >= 0 && filter <= 4, `Filtro PNG desconocido: ${filter}`);
      pixels[index] = (raw + predictor) & 0xff;
    }
  }
  return { width, height, pixels };
}

function changedPixels(
  rendered: DecodedPng,
  control: DecodedPng,
  region: [number, number, number, number],
) {
  const [left, top, right, bottom] = region;
  let changed = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * rendered.width + x) * 4;
      if (
        rendered.pixels[offset] !== control.pixels[offset] ||
        rendered.pixels[offset + 1] !== control.pixels[offset + 1] ||
        rendered.pixels[offset + 2] !== control.pixels[offset + 2] ||
        rendered.pixels[offset + 3] !== control.pixels[offset + 3]
      )
        changed += 1;
    }
  }
  return changed;
}

test("Resvg sin fuentes omite silenciosamente los elementos text", () => {
  const base = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80"><rect width="240" height="80" fill="white"/>';
  const withText = `${base}<text x="10" y="50" font-family="DejaVu Sans" font-size="24">GC-VITA-TEST1234</text></svg>`;
  const withoutText = `${base}</svg>`;
  const renderWithoutFonts = (svg: string) =>
    Buffer.from(
      new Resvg(svg, {
        font: { loadSystemFonts: false, defaultFontFamily: "DejaVu Sans" },
      })
        .render()
        .asPng(),
    );

  assert.ok(renderWithoutFonts(withText).equals(renderWithoutFonts(withoutText)));
});

test("Resvg pinta cada región de texto dinámico de la Gift Card", async () => {
  const compressed = await readFile(
    "public/gift-cards/gift-card-template-vita-lima.png.gz",
  );
  const svg = renderGiftCardSvg(
    {
      code: "GC-VITA-TEST1234",
      beneficiary: "SANDRA MEJIA",
      type: "SERVICIO",
      serviceName: "RELAX",
      serviceDescription: "texto de prueba",
      durationMinutes: 60,
      amount: 120,
      dedication: "Para mi reina",
      expirationDate: "2027-09-13",
    },
    gunzipSync(compressed).toString("base64"),
  );
  const controlSvg = svg.replace(/<text\b[\s\S]*?<\/text>/g, "");
  const rendered = decodeRgbaPng(renderGiftCardPng(svg));
  const control = decodeRgbaPng(renderGiftCardPng(controlSvg));

  assert.equal(rendered.width, 1645);
  assert.equal(rendered.height, 1379);
  const regions = {
    expiracion: [48, 55, 458, 100],
    codigo: [48, 100, 458, 145],
    beneficiario: [780, 325, 1505, 430],
    servicio: [780, 575, 1505, 640],
    descripcion: [780, 640, 1505, 695],
    dedicatoria: [780, 695, 1505, 755],
    duracion: [900, 990, 1450, 1060],
  } satisfies Record<string, [number, number, number, number]>;

  for (const [label, region] of Object.entries(regions)) {
    assert.ok(
      changedPixels(rendered, control, region) > 20,
      `Resvg no pintó texto visible en la región: ${label}`,
    );
  }
});

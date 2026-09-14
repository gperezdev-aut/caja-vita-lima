import { formatGiftCardDate } from "./giftCards.ts";

export type GiftCardTemplateData = {
  code: string;
  beneficiary: string;
  type: "SERVICIO" | "MONTO";
  serviceName?: string;
  serviceDescription?: string;
  serviceEmojiBase64?: string;
  durationMinutes?: number;
  amount: number;
  dedication?: string;
  expirationDate: string;
};

const WIDTH = 1645;
const HEIGHT = 1379;
const BROWN = "#572817";

export function splitGiftCardServiceName(value: unknown) {
  const normalized = normalizeGiftCardPresentationText(value).trim();
  const first =
    Array.from(
      new Intl.Segmenter("es", { granularity: "grapheme" }).segment(normalized),
    )[0]?.segment ?? "";
  if (!first || !/\p{Extended_Pictographic}/u.test(first)) {
    return { emoji: "", emojiKey: "", label: normalized };
  }
  return {
    emoji: first,
    emojiKey: Array.from(first)
      .map((character) => character.codePointAt(0)!.toString(16))
      .join("-"),
    label: normalized.slice(first.length).trim(),
  };
}

const windows1252Bytes = new Map<string, number>([
  ["€", 0x80],
  ["‚", 0x82],
  ["ƒ", 0x83],
  ["„", 0x84],
  ["…", 0x85],
  ["†", 0x86],
  ["‡", 0x87],
  ["ˆ", 0x88],
  ["‰", 0x89],
  ["Š", 0x8a],
  ["‹", 0x8b],
  ["Œ", 0x8c],
  ["Ž", 0x8e],
  ["‘", 0x91],
  ["’", 0x92],
  ["“", 0x93],
  ["”", 0x94],
  ["•", 0x95],
  ["–", 0x96],
  ["—", 0x97],
  ["˜", 0x98],
  ["™", 0x99],
  ["š", 0x9a],
  ["›", 0x9b],
  ["œ", 0x9c],
  ["ž", 0x9e],
  ["Ÿ", 0x9f],
]);

function mojibakeScore(value: string) {
  return (value.match(/[ÃÂâð�]/g) ?? []).length;
}

export function normalizeGiftCardPresentationText(value: unknown) {
  let normalized = String(value ?? "").normalize("NFC");
  for (let pass = 0; pass < 3 && mojibakeScore(normalized); pass += 1) {
    const bytes: number[] = [];
    let encodable = true;
    for (const character of normalized) {
      const mapped = windows1252Bytes.get(character);
      if (mapped !== undefined) {
        bytes.push(mapped);
        continue;
      }
      const codePoint = character.codePointAt(0) ?? 0;
      if (codePoint > 0xff) {
        encodable = false;
        break;
      }
      bytes.push(codePoint);
    }
    if (!encodable) break;
    try {
      const candidate = new TextDecoder("utf-8", { fatal: true })
        .decode(Uint8Array.from(bytes))
        .normalize("NFC");
      if (mojibakeScore(candidate) >= mojibakeScore(normalized)) break;
      normalized = candidate;
    } catch {
      break;
    }
  }
  return normalized;
}

export function escapeGiftCardXml(value: unknown) {
  return String(value ?? "").replace(
    /[<>&"']/g,
    (character) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[character] ?? character,
  );
}

export function wrapGiftCardText(value: string, maxCharacters: number) {
  const words = value.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";

  while (words.length) {
    let word = words.shift()!;
    if (Array.from(word).length > maxCharacters) {
      if (current) {
        lines.push(current);
        current = "";
      }
      const characters = Array.from(word);
      while (characters.length > maxCharacters)
        lines.push(characters.splice(0, maxCharacters).join(""));
      word = characters.join("");
      if (!word) continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (Array.from(candidate).length <= maxCharacters) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

export function fitGiftCardText(
  value: string,
  options: {
    baseCharacters: number;
    maxLines: number;
    baseFontSize: number;
    minFontSize: number;
  },
) {
  for (
    let fontSize = options.baseFontSize;
    fontSize >= options.minFontSize;
    fontSize -= 2
  ) {
    const maxCharacters = Math.floor(
      (options.baseCharacters * options.baseFontSize) / fontSize,
    );
    const lines = wrapGiftCardText(value, maxCharacters);
    if (lines.length <= options.maxLines) return { lines, fontSize };
  }
  const maxCharacters = Math.ceil(Array.from(value).length / options.maxLines);
  return {
    lines: wrapGiftCardText(value, maxCharacters),
    fontSize: options.minFontSize,
  };
}

function textLines(
  lines: string[],
  options: {
    x: number;
    y: number;
    lineHeight: number;
    fontSize: number;
    weight?: number;
    style?: string;
  },
) {
  const { x, y, lineHeight, fontSize, weight = 400, style = "" } = options;
  return `<text x="${x}" y="${y}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="${weight}" fill="${BROWN}" ${style}>${lines
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeGiftCardXml(line)}</tspan>`,
    )
    .join("")}</text>`;
}

export function renderGiftCardSvg(
  data: GiftCardTemplateData,
  templateBase64: string,
) {
  const beneficiary = normalizeGiftCardPresentationText(
    data.beneficiary,
  ).toLocaleUpperCase("es-PE");
  const splitServiceName = splitGiftCardServiceName(data.serviceName);
  const serviceName = (
    data.serviceEmojiBase64
      ? splitServiceName.label
      : normalizeGiftCardPresentationText(data.serviceName)
  ).toLocaleUpperCase("es-PE");
  const serviceDescription = normalizeGiftCardPresentationText(
    data.serviceDescription,
  ).trim();
  const dedication = normalizeGiftCardPresentationText(data.dedication).trim();
  const beneficiaryLayout = fitGiftCardText(beneficiary, {
    baseCharacters: 25,
    maxLines: 3,
    baseFontSize: 56,
    minFontSize: 34,
  });
  const expiration = formatGiftCardDate(data.expirationDate);
  const isService = data.type === "SERVICIO";
  const giftLayout = isService
    ? fitGiftCardText(serviceName, {
        baseCharacters: 28,
        maxLines: 3,
        baseFontSize: 54,
        minFontSize: 30,
      })
    : {
        lines: [`GIFT CARD POR S/ ${Number(data.amount).toFixed(2)}`],
        fontSize: 60,
      };
  const descriptionLayout =
    isService && serviceDescription
      ? fitGiftCardText(serviceDescription, {
          baseCharacters: 44,
          maxLines: 4,
          baseFontSize: 30,
          minFontSize: 20,
        })
      : { lines: [], fontSize: 30 };
  const dedicationLayout = dedication
    ? fitGiftCardText(`“${dedication}”`, {
        baseCharacters: 50,
        maxLines: 3,
        baseFontSize: 27,
        minFontSize: 18,
      })
    : { lines: [], fontSize: 27 };

  const beneficiaryStartY = 360;
  const beneficiaryLineHeight = Math.round(beneficiaryLayout.fontSize * 1.16);
  const giftStartY = isService ? 610 : 615;
  const giftLineHeight = Math.round(giftLayout.fontSize * 1.14);
  const giftEndY =
    giftStartY + Math.max(0, giftLayout.lines.length - 1) * giftLineHeight;
  const descriptionY = giftEndY + 46;
  const descriptionLineHeight = Math.round(descriptionLayout.fontSize * 1.27);
  const descriptionEndY = descriptionLayout.lines.length
    ? descriptionY +
      (descriptionLayout.lines.length - 1) * descriptionLineHeight
    : giftEndY;
  const dedicationY = isService ? descriptionEndY + 50 : 755;
  const dedicationLineHeight = Math.round(dedicationLayout.fontSize * 1.3);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="gift-card-title gift-card-description">
  <title id="gift-card-title">Gift Card Vita Lima para ${escapeGiftCardXml(beneficiary)}</title>
  <desc id="gift-card-description">${escapeGiftCardXml(isService ? serviceName : `Gift Card por S/ ${Number(data.amount).toFixed(2)}`)}</desc>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#fffdf9"/>
  <image href="data:image/png;base64,${templateBase64}" x="0" y="0" width="${WIDTH}" height="${HEIGHT}" preserveAspectRatio="xMidYMid meet"/>
  <rect x="48" y="45" width="410" height="112" rx="4" fill="#ffffff"/>
  <text x="245" y="91" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="29" fill="${BROWN}">EXPIRA: ${escapeGiftCardXml(expiration)}</text>
  <text x="245" y="132" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="27" fill="${BROWN}">CÓDIGO: ${escapeGiftCardXml(data.code)}</text>
  <text x="1142" y="300" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="27" letter-spacing="4" fill="${BROWN}">PARA</text>
  ${textLines(beneficiaryLayout.lines, { x: 1142, y: beneficiaryStartY, lineHeight: beneficiaryLineHeight, fontSize: beneficiaryLayout.fontSize, weight: 600 })}
  <text x="1142" y="535" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="27" letter-spacing="3" fill="${BROWN}">${isService ? "SERVICIO" : "REGALO"}</text>
  ${isService && data.serviceEmojiBase64 ? `<image href="data:image/png;base64,${data.serviceEmojiBase64}" x="820" y="565" width="54" height="54" preserveAspectRatio="xMidYMid meet"/>` : ""}
  ${textLines(giftLayout.lines, { x: 1142, y: giftStartY, lineHeight: giftLineHeight, fontSize: giftLayout.fontSize, weight: 600 })}
  ${descriptionLayout.lines.length ? textLines(descriptionLayout.lines, { x: 1142, y: descriptionY, lineHeight: descriptionLineHeight, fontSize: descriptionLayout.fontSize, weight: 400 }) : ""}
  ${dedicationLayout.lines.length ? textLines(dedicationLayout.lines, { x: 1142, y: dedicationY, lineHeight: dedicationLineHeight, fontSize: dedicationLayout.fontSize, weight: 400, style: 'font-style="italic"' }) : ""}
  ${isService ? `<text x="1142" y="1030" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="600" fill="${BROWN}">${escapeGiftCardXml(Number(data.durationMinutes ?? 0))} MINUTOS</text>` : ""}
</svg>`;
}

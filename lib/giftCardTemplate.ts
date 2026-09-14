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
// The safe region is 885 px wide. The inset absorbs italic/bold glyph overhangs
// that are not represented by a font's advance width.
const TEXT_MAX_WIDTH = 850;

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

// DejaVu Sans Bold advance widths in em. Bold is the widest font weight used
// by the dynamic content and provides a conservative envelope for regular text.
const LATIN_UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LATIN_UPPERCASE_EM = [
  0.774, 0.762, 0.734, 0.83, 0.683, 0.683, 0.821, 0.837, 0.372, 0.372,
  0.775, 0.637, 0.995, 0.837, 0.85, 0.733, 0.85, 0.77, 0.72, 0.682, 0.812,
  0.774, 1.103, 0.771, 0.724, 0.725,
];
const LATIN_LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const LATIN_LOWERCASE_EM = [
  0.675, 0.716, 0.593, 0.716, 0.678, 0.435, 0.716, 0.712, 0.343, 0.343,
  0.665, 0.343, 1.042, 0.712, 0.687, 0.716, 0.716, 0.493, 0.595, 0.478,
  0.712, 0.652, 0.924, 0.645, 0.652, 0.582,
];
const PUNCTUATION_EM: Record<string, number> = {
  " ": 0.348,
  "/": 0.365,
  "+": 0.838,
  "(": 0.457,
  ")": 0.457,
  ".": 0.38,
  ",": 0.38,
  ":": 0.4,
  ";": 0.4,
  "-": 0.42,
  "–": 0.7,
  "—": 1,
  "'": 0.3,
  "’": 0.3,
  '"': 0.5,
  "“": 0.5,
  "”": 0.5,
};

function giftCardGlyphWidthEm(grapheme: string) {
  const base = grapheme.normalize("NFD").replace(/\p{Mark}/gu, "");
  if (!base) return 0;
  const punctuation = PUNCTUATION_EM[base];
  if (punctuation !== undefined) return punctuation;
  if (/^\d$/u.test(base)) return 0.696;
  const uppercaseIndex = LATIN_UPPERCASE.indexOf(base);
  if (uppercaseIndex >= 0) return LATIN_UPPERCASE_EM[uppercaseIndex];
  const lowercaseIndex = LATIN_LOWERCASE.indexOf(base);
  if (lowercaseIndex >= 0) return LATIN_LOWERCASE_EM[lowercaseIndex];
  if (/\p{Extended_Pictographic}/u.test(grapheme)) return 1.15;
  return 0.85;
}

export function estimateGiftCardTextWidth(value: string, fontSize: number) {
  const graphemes = Array.from(
    new Intl.Segmenter("es", { granularity: "grapheme" }).segment(value),
    ({ segment }) => segment,
  );
  return (
    graphemes.reduce(
      (width, grapheme) => width + giftCardGlyphWidthEm(grapheme),
      0,
    ) * fontSize
  );
}

function wrapGiftCardTextByWidth(
  value: string,
  maxWidth: number,
  fontSize: number,
) {
  const words = value.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const originalWord of words) {
    let word = originalWord;
    const candidate = current ? `${current} ${word}` : word;
    if (estimateGiftCardTextWidth(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = "";
    }
    if (estimateGiftCardTextWidth(word, fontSize) <= maxWidth) {
      current = word;
      continue;
    }
    const graphemes = Array.from(
      new Intl.Segmenter("es", { granularity: "grapheme" }).segment(word),
      ({ segment }) => segment,
    );
    let fragment = "";
    for (const grapheme of graphemes) {
      const next = `${fragment}${grapheme}`;
      if (fragment && estimateGiftCardTextWidth(next, fontSize) > maxWidth) {
        lines.push(fragment);
        fragment = grapheme;
      } else {
        fragment = next;
      }
    }
    word = fragment;
    if (word) current = word;
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
    maxWidth?: number;
  },
) {
  const minimum = options.maxWidth
    ? Math.min(options.minFontSize, 10)
    : options.minFontSize;
  for (
    let fontSize = options.baseFontSize;
    fontSize >= minimum;
    fontSize -= 2
  ) {
    const lines = options.maxWidth
      ? wrapGiftCardTextByWidth(value, options.maxWidth, fontSize)
      : wrapGiftCardText(
          value,
          Math.floor(
            (options.baseCharacters * options.baseFontSize) / fontSize,
          ),
        );
    if (lines.length <= options.maxLines) return { lines, fontSize };
  }
  if (options.maxWidth) {
    return {
      lines: wrapGiftCardTextByWidth(value, options.maxWidth, minimum),
      fontSize: minimum,
    };
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
    section?: string;
  },
) {
  const {
    x,
    y,
    lineHeight,
    fontSize,
    weight = 400,
    style = "",
    section = "content",
  } = options;
  return `<text data-section="${section}" x="${x}" y="${y}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="${weight}" fill="${BROWN}" ${style}>${lines
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeGiftCardXml(line)}</tspan>`,
    )
    .join("")}</text>`;
}

type GiftCardTextLayout = ReturnType<typeof fitGiftCardText>;

function layoutHeight(layout: GiftCardTextLayout, lineHeight: number) {
  if (!layout.lines.length) return 0;
  return layout.fontSize + Math.max(0, layout.lines.length - 1) * lineHeight;
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
    baseCharacters: 22,
    maxLines: 3,
    baseFontSize: 70,
    minFontSize: 38,
    maxWidth: TEXT_MAX_WIDTH,
  });
  const expiration = formatGiftCardDate(data.expirationDate);
  const isService = data.type === "SERVICIO";
  const giftLayout = isService
    ? fitGiftCardText(serviceName, {
        baseCharacters: 24,
        maxLines: 3,
        baseFontSize: 63,
        minFontSize: 34,
        maxWidth: TEXT_MAX_WIDTH,
      })
    : fitGiftCardText(`GIFT CARD POR S/ ${Number(data.amount).toFixed(2)}`, {
        baseCharacters: 24,
        maxLines: 1,
        baseFontSize: 64,
        minFontSize: 34,
        maxWidth: TEXT_MAX_WIDTH,
      });
  const descriptionLayout =
    isService && serviceDescription
      ? fitGiftCardText(serviceDescription, {
          baseCharacters: 43,
          maxLines: 6,
          baseFontSize: 32,
          minFontSize: 18,
          maxWidth: TEXT_MAX_WIDTH,
        })
      : { lines: [], fontSize: 32 };
  const dedicationLayout = dedication
    ? fitGiftCardText(`“${dedication}”`, {
        baseCharacters: 52,
        maxLines: 5,
        baseFontSize: 25,
        minFontSize: 16,
        maxWidth: TEXT_MAX_WIDTH,
      })
    : { lines: [], fontSize: 25 };

  const beneficiaryLineHeight = Math.round(beneficiaryLayout.fontSize * 1.08);
  const giftLineHeight = Math.round(giftLayout.fontSize * 1.08);
  const descriptionLineHeight = Math.round(descriptionLayout.fontSize * 1.24);
  const dedicationLineHeight = Math.round(dedicationLayout.fontSize * 1.24);
  const labelHeight = 25;
  const labelGap = 20;
  const sections = [
    labelHeight +
      labelGap +
      layoutHeight(beneficiaryLayout, beneficiaryLineHeight),
    labelHeight + labelGap + layoutHeight(giftLayout, giftLineHeight),
    ...(descriptionLayout.lines.length
      ? [
          18 +
            labelHeight +
            labelGap +
            layoutHeight(descriptionLayout, descriptionLineHeight),
        ]
      : []),
    ...(isService ? [46] : []),
    ...(dedicationLayout.lines.length
      ? [layoutHeight(dedicationLayout, dedicationLineHeight)]
      : []),
  ];
  const contentTop = isService ? 282 : 350;
  const contentBottom = 1050;
  const availableHeight = contentBottom - contentTop;
  const naturalHeight = sections.reduce((sum, height) => sum + height, 0);
  const naturalGap =
    sections.length > 1
      ? Math.min(
          76,
          Math.max(
            24,
            (availableHeight - naturalHeight) / (sections.length - 1),
          ),
        )
      : 0;
  const occupiedHeight =
    naturalHeight + naturalGap * Math.max(0, sections.length - 1);
  const verticalScale = Math.min(1, availableHeight / occupiedHeight);
  const scale = (value: number) =>
    Math.max(1, Math.round(value * verticalScale));
  const sectionGap = scale(naturalGap);
  let cursorY = isService
    ? contentTop
    : contentTop + Math.max(0, (availableHeight - occupiedHeight) / 2);

  const renderLabel = (label: string, section: string) => {
    const svg = `<text data-section="${section}" x="1142" y="${cursorY + scale(labelHeight)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${scale(25)}" font-weight="500" letter-spacing="4" fill="${BROWN}">${label}</text>`;
    cursorY += scale(labelHeight + labelGap);
    return svg;
  };
  const renderLayout = (
    layout: GiftCardTextLayout,
    lineHeight: number,
    options: { weight?: number; style?: string; section?: string } = {},
  ) => {
    const fontSize = scale(layout.fontSize);
    const scaledLineHeight = scale(lineHeight);
    const svg = textLines(layout.lines, {
      x: 1142,
      y: cursorY + fontSize,
      lineHeight: scaledLineHeight,
      fontSize,
      ...options,
    });
    cursorY += layoutHeight({ ...layout, fontSize }, scaledLineHeight);
    return svg;
  };
  const addSectionGap = () => {
    cursorY += sectionGap;
    return "";
  };

  const beneficiarySvg = `${renderLabel("PARA", "beneficiary-label")}${renderLayout(
    beneficiaryLayout,
    beneficiaryLineHeight,
    { weight: 600, section: "beneficiary" },
  )}`;
  addSectionGap();
  const giftSvg = `${renderLabel(isService ? "SERVICIO" : "REGALO", "gift-label")}${
    isService && data.serviceEmojiBase64
      ? `<image data-section="service-emoji" href="data:image/png;base64,${data.serviceEmojiBase64}" x="1262" y="${cursorY - scale(labelHeight + labelGap) - scale(2)}" width="${scale(34)}" height="${scale(34)}" preserveAspectRatio="xMidYMid meet"/>`
      : ""
  }${renderLayout(giftLayout, giftLineHeight, {
    weight: 600,
    section: isService ? "service" : "amount",
  })}`;
  let descriptionSvg = "";
  if (descriptionLayout.lines.length) {
    addSectionGap();
    descriptionSvg = `<line data-section="included-divider" x1="925" y1="${cursorY}" x2="1359" y2="${cursorY}" stroke="${BROWN}" stroke-width="1" opacity="0.28"/>`;
    cursorY += scale(18);
    descriptionSvg += renderLabel("INCLUYE", "included-label");
    descriptionSvg += renderLayout(
      descriptionLayout,
      descriptionLineHeight,
      { weight: 400, section: "description" },
    );
  }
  const durationSvg = isService
    ? `${addSectionGap()}<text data-section="duration" x="1142" y="${cursorY + scale(40)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${scale(42)}" font-weight="700" letter-spacing="1" fill="${BROWN}">${escapeGiftCardXml(Number(data.durationMinutes ?? 0))} MINUTOS</text>`
    : "";
  if (isService) cursorY += scale(46);
  const dedicationSvg = dedicationLayout.lines.length
    ? `${addSectionGap()}${renderLayout(
        dedicationLayout,
        dedicationLineHeight,
        { style: 'font-style="italic"', section: "dedication" },
      )}`
    : "";
  const contentEnd = Math.round(cursorY);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="gift-card-title gift-card-description">
  <title id="gift-card-title">Gift Card Vita Lima para ${escapeGiftCardXml(beneficiary)}</title>
  <desc id="gift-card-description">${escapeGiftCardXml(isService ? serviceName : `Gift Card por S/ ${Number(data.amount).toFixed(2)}`)}</desc>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#fffdf9"/>
  <image href="data:image/png;base64,${templateBase64}" x="0" y="0" width="${WIDTH}" height="${HEIGHT}" preserveAspectRatio="xMidYMid meet"/>
  <rect x="48" y="45" width="410" height="112" rx="4" fill="#ffffff"/>
  <text data-section="expiration" x="245" y="91" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="29" fill="${BROWN}">EXPIRA: ${escapeGiftCardXml(expiration)}</text>
  <text data-section="code" x="245" y="132" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="27" fill="${BROWN}">CÓDIGO: ${escapeGiftCardXml(data.code)}</text>
  <g data-layout-top="${Math.round(contentTop)}" data-layout-bottom="${contentEnd}">
    ${beneficiarySvg}
    ${giftSvg}
    ${descriptionSvg}
    ${durationSvg}
    ${dedicationSvg}
  </g>
</svg>`;
}

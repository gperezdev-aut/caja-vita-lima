import { Resvg } from "@resvg/resvg-js";

export const GIFT_CARD_PNG_WIDTH = 1645;
export const GIFT_CARD_PNG_HEIGHT = 1379;

export function renderGiftCardPng(svg: string) {
  return new Resvg(svg, {
    fitTo: { mode: "width", value: GIFT_CARD_PNG_WIDTH },
    font: {
      loadSystemFonts: true,
      defaultFontFamily: "DejaVu Sans",
    },
  })
    .render()
    .asPng();
}

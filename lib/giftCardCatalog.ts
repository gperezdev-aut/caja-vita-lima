export type GiftCardCatalogIdentity = {
  serviceCode: string;
  releaseId: string;
  priceVersion: string;
};

export type GiftCardCatalogDescriptionRow = {
  service_code?: unknown;
  release_id?: unknown;
  price_version?: unknown;
  included_es?: unknown;
};

export const GIFT_CARD_DESCRIPTION_FALLBACK =
  "Detalle del servicio no disponible en el catálogo histórico";

export function resolveGiftCardServiceDescription(
  identity: GiftCardCatalogIdentity,
  rows: GiftCardCatalogDescriptionRow[],
) {
  const exactMatches = rows.filter(
    (row) =>
      row.service_code === identity.serviceCode &&
      row.release_id === identity.releaseId &&
      row.price_version === identity.priceVersion,
  );
  if (exactMatches.length !== 1) return GIFT_CARD_DESCRIPTION_FALLBACK;

  const included = exactMatches[0].included_es;
  return typeof included === "string" && included.trim()
    ? included.trim()
    : GIFT_CARD_DESCRIPTION_FALLBACK;
}

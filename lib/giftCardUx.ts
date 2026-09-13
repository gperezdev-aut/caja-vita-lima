export type GiftCardClientOption = {
  id: string;
  name: string;
  whatsapp: string;
};

export type GiftCardServiceOption = {
  code: string;
  name: string;
  duration: number;
  price: number;
  category: string;
  description?: string;
};

function searchable(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-PE")
    .trim();
}

function rankMatch(fields: string[], query: string) {
  const normalizedFields = fields.map(searchable);
  if (normalizedFields.some((field) => field === query)) return 0;
  if (normalizedFields.some((field) => field.startsWith(query))) return 1;
  if (
    normalizedFields.some((field) =>
      field.split(/\s+/).some((word) => word.startsWith(query)),
    )
  )
    return 2;
  return 3;
}

const categorySearchLabels: Record<string, string> = {
  INDIVIDUAL: "Individual",
  PACKAGE_TWO: "Pareja",
  HOME: "Domicilio",
  PROGRAM: "Programa",
  BEAUTY: "Belleza",
  FACIAL: "Facial",
};

export function findGiftCardClients(
  clients: GiftCardClientOption[],
  query: string,
  limit = 8,
) {
  const text = searchable(query);
  const phone = query.replace(/\D/g, "");
  if (text.length < 2 && phone.length < 2)
    return { results: [], total: 0, ready: false };

  const phoneSearch = phone.length >= 3;
  const matches = clients
    .map((client, index) => {
      const normalizedName = searchable(client.name);
      const normalizedPhone = client.whatsapp.replace(/\D/g, "");
      const nameMatches = text.length >= 2 && normalizedName.includes(text);
      const phoneMatches = phone.length >= 2 && normalizedPhone.includes(phone);
      if (!nameMatches && !phoneMatches) return null;
      const phoneRank =
        normalizedPhone === phone
          ? 0
          : normalizedPhone.startsWith(phone)
            ? 1
            : 2;
      return {
        client,
        index,
        rank:
          phoneSearch && phoneMatches
            ? phoneRank
            : rankMatch([client.name], text),
        phonePriority: phoneSearch && phoneMatches ? 0 : 1,
      };
    })
    .filter((match): match is NonNullable<typeof match> => Boolean(match))
    .sort(
      (left, right) =>
        left.phonePriority - right.phonePriority ||
        left.rank - right.rank ||
        left.index - right.index,
    );

  return {
    results: matches.slice(0, limit).map((match) => match.client),
    total: matches.length,
    ready: true,
  };
}

export function findGiftCardServices(
  services: GiftCardServiceOption[],
  query: string,
  limit = 8,
  category = "",
) {
  const text = searchable(query);
  const matches = services
    .map((service, index) => {
      if (category && service.category !== category) return null;
      const fields = [
        service.name,
        service.code,
        service.category,
        categorySearchLabels[service.category] ?? service.category,
        service.description ?? "",
      ];
      const normalizedFields = fields.map(searchable);
      if (text && !normalizedFields.some((field) => field.includes(text)))
        return null;
      return { service, index, rank: text ? rankMatch(fields, text) : 3 };
    })
    .filter((match): match is NonNullable<typeof match> => Boolean(match))
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.service.name.localeCompare(right.service.name, "es") ||
        left.index - right.index,
    );

  return {
    results: matches.slice(0, limit).map((match) => match.service),
    total: matches.length,
  };
}

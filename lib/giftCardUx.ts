export type GiftCardClientOption = {
  id: string;
  name: string;
  whatsapp: string;
};

function searchable(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-PE");
}

export function findGiftCardClients(
  clients: GiftCardClientOption[],
  query: string,
  limit = 20,
) {
  const text = searchable(query.trim());
  const phone = query.replace(/\D/g, "");
  const matches = clients.filter((client) => {
    if (!text && !phone) return true;
    const nameMatches = text ? searchable(client.name).includes(text) : false;
    const phoneMatches = phone
      ? client.whatsapp.replace(/\D/g, "").includes(phone)
      : false;
    return nameMatches || phoneMatches;
  });

  return {
    results: matches.slice(0, limit),
    total: matches.length,
  };
}

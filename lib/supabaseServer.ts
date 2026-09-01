import "server-only";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export type SupabaseResult<T> = {
  data: T[];
  error: string | null;
};

function missingEnvResult<T>(): SupabaseResult<T> {
  return {
    data: [],
    error:
      "Faltan variables de entorno: SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.",
  };
}

async function supabaseRequest<T = Record<string, unknown>>(
  path: string,
  init?: RequestInit
): Promise<SupabaseResult<T>> {
  if (!supabaseUrl || !serviceRoleKey) {
    return missingEnvResult<T>();
  }

  const endpoint = `${supabaseUrl}/rest/v1/${path}`;

  try {
    const response = await fetch(endpoint, {
      ...init,
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = await response.text();
      return {
        data: [],
        error: `Supabase respondió ${response.status}: ${detail}`,
      };
    }

    if (response.status === 204) {
      return { data: [], error: null };
    }

    const body = await response.text();

    if (!body.trim()) {
      return { data: [], error: null };
    }

    const data = JSON.parse(body) as T[];
    return { data, error: null };
  } catch (error) {
    return {
      data: [],
      error:
        error instanceof Error
          ? error.message
          : "Error desconocido consultando Supabase.",
    };
  }
}

export async function supabaseSelect<T = Record<string, unknown>>(
  viewName: string
): Promise<SupabaseResult<T>> {
  return supabaseRequest<T>(`${viewName}?select=*`, {
    method: "GET",
  });
}

export async function supabaseSelectWhere<T = Record<string, unknown>>(
  tableOrView: string,
  query: string
): Promise<SupabaseResult<T>> {
  return supabaseRequest<T>(`${tableOrView}?${query}`, {
    method: "GET",
  });
}

const DEFAULT_PAGE_SIZE = 1000;
const MAX_PAGES = 500;

/**
 * Igual que supabaseSelectWhere, pero sigue pidiendo páginas hasta traer
 * todas las filas que cumplen el filtro. Necesario porque ni supabaseSelect
 * ni supabaseSelectWhere mandan un límite propio: sin esto, un tope de fila
 * del lado de PostgREST (server-side) podría cortar el resultado en
 * silencio sin ningún error. Usa `Prefer: count=exact` para conocer el
 * total real de filas vía el header Content-Range y saber con certeza
 * cuándo se llegó al final, en vez de asumirlo solo por el tamaño de la
 * última página (que puede engañar si el servidor aplica su propio tope
 * por debajo del pageSize pedido).
 */
export async function supabaseSelectAllWhere<T = Record<string, unknown>>(
  tableOrView: string,
  query: string,
  pageSize: number = DEFAULT_PAGE_SIZE
): Promise<SupabaseResult<T>> {
  if (!supabaseUrl || !serviceRoleKey) {
    return missingEnvResult<T>();
  }

  const allData: T[] = [];
  let offset = 0;
  let total: number | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const endpoint = `${supabaseUrl}/rest/v1/${tableOrView}?${query}&limit=${pageSize}&offset=${offset}`;

    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
          Prefer: "count=exact",
        },
        cache: "no-store",
      });

      if (!response.ok) {
        const detail = await response.text();
        return {
          data: allData,
          error: `Supabase respondió ${response.status}: ${detail}`,
        };
      }

      const body = await response.text();
      const pageData = body.trim() ? (JSON.parse(body) as T[]) : [];
      allData.push(...pageData);

      const contentRange = response.headers.get("content-range");
      const totalFromHeader = contentRange?.split("/")[1];
      if (totalFromHeader && totalFromHeader !== "*") {
        total = Number(totalFromHeader);
      }

      if (pageData.length === 0) break;

      offset += pageData.length;

      if (total !== null) {
        if (offset >= total) break;
      } else if (pageData.length < pageSize) {
        // Sin Content-Range no hay forma de confirmar el total: nos
        // quedamos con la señal descrita (página incompleta = fin).
        break;
      }
    } catch (error) {
      return {
        data: allData,
        error:
          error instanceof Error
            ? error.message
            : "Error desconocido consultando Supabase.",
      };
    }
  }

  return { data: allData, error: null };
}

export async function supabaseInsert<T = Record<string, unknown>>(
  tableName: string,
  payload: Record<string, unknown> | Record<string, unknown>[]
): Promise<SupabaseResult<T>> {
  return supabaseRequest<T>(tableName, {
    method: "POST",
    headers: {
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  });
}

export async function supabaseUpsert<T = Record<string, unknown>>(
  tableName: string,
  payload: Record<string, unknown> | Record<string, unknown>[],
  onConflict: string
): Promise<SupabaseResult<T>> {
  return supabaseRequest<T>(`${tableName}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(payload),
  });
}

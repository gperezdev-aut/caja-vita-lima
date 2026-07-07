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

    const text = await response.text();

    if (!response.ok) {
      return {
        data: [],
        error: `Supabase respondió ${response.status}: ${
          text || response.statusText
        }`,
      };
    }

    if (!text) {
      return { data: [], error: null };
    }

    const parsed = JSON.parse(text) as T[] | T;

    return {
      data: Array.isArray(parsed) ? parsed : [parsed],
      error: null,
    };
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

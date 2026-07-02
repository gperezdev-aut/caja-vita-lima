import "server-only";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export type SupabaseResult<T> = {
  data: T[];
  error: string | null;
};

export async function supabaseSelect<T = Record<string, unknown>>(
  viewName: string
): Promise<SupabaseResult<T>> {
  if (!supabaseUrl || !serviceRoleKey) {
    return {
      data: [],
      error:
        "Faltan variables de entorno: SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.",
    };
  }

  const endpoint = `${supabaseUrl}/rest/v1/${viewName}?select=*`;

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
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

    const data = (await response.json()) as T[];
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

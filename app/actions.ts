"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  authCookieName,
  createSessionToken,
  type CajaRole,
} from "@/lib/auth";
import { supabaseSelectWhere, supabaseUpsert } from "@/lib/supabaseServer";
import { getServerEnv } from "@/lib/env";

const MAX_INTENTOS_FALLIDOS = 5;
const BLOQUEO_MINUTOS = 15;

type UsuarioRow = {
  id: number;
  usuario: string;
  pin: string | null;
  rol: CajaRole;
  nombre: string | null;
  activo: boolean | null;
};

type LoginIntentoRow = {
  usuario: string;
  intentos_fallidos: number | null;
  bloqueado_hasta: string | null;
};

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function normalizeUser(value: FormDataEntryValue | null) {
  return clean(value).toLowerCase();
}

export async function loginAction(formData: FormData) {
  const usuario = normalizeUser(formData.get("usuario"));
  const pin = clean(formData.get("pin"));
  const sessionSecret = getServerEnv("CAJA_SESSION_SECRET");

  if (!sessionSecret) {
    redirect("/login?error=config");
  }

  if (!usuario || !pin) {
    redirect("/login?error=missing");
  }

  const intentosPrevios = await supabaseSelectWhere<LoginIntentoRow>(
    "login_intentos",
    [
      "select=usuario,intentos_fallidos,bloqueado_hasta",
      `usuario=eq.${encodeURIComponent(usuario)}`,
      "limit=1",
    ].join("&")
  );

  const intentoActual = intentosPrevios.data?.[0];
  const bloqueadoHasta = intentoActual?.bloqueado_hasta
    ? new Date(intentoActual.bloqueado_hasta)
    : null;

  if (bloqueadoHasta && bloqueadoHasta.getTime() > Date.now()) {
    redirect("/login?error=bloqueado");
  }

  const result = await supabaseSelectWhere<UsuarioRow>(
    "usuarios",
    [
      "select=id,usuario,pin,rol,nombre,activo",
      `usuario=eq.${encodeURIComponent(usuario)}`,
      "activo=eq.true",
      "limit=1",
    ].join("&")
  );

  if (result.error) {
    redirect("/login?error=db");
  }

  const user = result.data?.[0];

  if (!user || user.pin !== pin) {
    const intentosFallidos = (intentoActual?.intentos_fallidos ?? 0) + 1;
    const nuevoBloqueo =
      intentosFallidos >= MAX_INTENTOS_FALLIDOS
        ? new Date(Date.now() + BLOQUEO_MINUTOS * 60 * 1000).toISOString()
        : null;

    await supabaseUpsert(
      "login_intentos",
      {
        usuario,
        intentos_fallidos: intentosFallidos,
        bloqueado_hasta: nuevoBloqueo,
        ultimo_intento: new Date().toISOString(),
      },
      "usuario"
    );

    redirect("/login?error=invalid");
  }

  await supabaseUpsert(
    "login_intentos",
    {
      usuario,
      intentos_fallidos: 0,
      bloqueado_hasta: null,
      ultimo_intento: new Date().toISOString(),
    },
    "usuario"
  );

  const cookieStore = await cookies();
  const token = createSessionToken({
    usuario: user.usuario,
    nombre: user.nombre || user.usuario,
    rol: user.rol,
    iat: Date.now(),
  });

  cookieStore.set(authCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  redirect("/");
}

export async function logoutAction() {
  const cookieStore = await cookies();

  cookieStore.delete(authCookieName);

  redirect("/login?loggedOut=1");
}

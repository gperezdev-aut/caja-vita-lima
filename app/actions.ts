"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  authCookieName,
  createSessionToken,
  type CajaRole,
} from "@/lib/auth";
import { supabaseSelectWhere } from "@/lib/supabaseServer";
import { getServerEnv } from "@/lib/env";

type UsuarioRow = {
  id: number;
  usuario: string;
  pin: string | null;
  rol: CajaRole;
  nombre: string | null;
  activo: boolean | null;
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
    redirect("/login?error=invalid");
  }

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

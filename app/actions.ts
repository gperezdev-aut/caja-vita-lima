"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authCookieName } from "@/lib/auth";

export async function loginAction(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const expectedPassword = process.env.CAJA_APP_PASSWORD;
  const sessionSecret = process.env.CAJA_SESSION_SECRET;

  if (!expectedPassword || !sessionSecret) {
    redirect("/login?error=config");
  }

  if (password !== expectedPassword) {
    redirect("/login?error=invalid");
  }

  const cookieStore = await cookies();

  cookieStore.set(authCookieName, sessionSecret, {
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

import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const AUTH_COOKIE_NAME = "caja_auth";

export async function requireAuth() {
  const sessionSecret = process.env.CAJA_SESSION_SECRET;

  if (!sessionSecret) {
    redirect("/login?error=config");
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;

  if (token !== sessionSecret) {
    redirect("/login");
  }
}

export async function isLoggedIn() {
  const sessionSecret = process.env.CAJA_SESSION_SECRET;

  if (!sessionSecret) {
    return false;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;

  return token === sessionSecret;
}

export const authCookieName = AUTH_COOKIE_NAME;

import "server-only";

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const AUTH_COOKIE_NAME = "caja_auth";

export type CajaRole = "ADMIN_GERALD" | "SOCIO" | "VITA_OPERACION";

export type CajaModule =
  | "dashboard"
  | "citas-hoy"
  | "nueva-atencion"
  | "registrar-salida"
  | "comprobantes"
  | "cierre-caja"
  | "alertas";

export type CajaSession = {
  usuario: string;
  nombre: string;
  rol: CajaRole;
  iat: number;
};

export type CajaNavItem = {
  key: CajaModule;
  label: string;
  href: string;
};

const NAV_ITEMS: CajaNavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/" },
  { key: "citas-hoy", label: "Citas de hoy", href: "/citas-hoy" },
  { key: "nueva-atencion", label: "Nueva atención", href: "/nueva-atencion" },
  { key: "registrar-salida", label: "Registrar salida", href: "/registrar-salida" },
  { key: "comprobantes", label: "Comprobantes", href: "/comprobantes" },
  { key: "cierre-caja", label: "Cierre de caja", href: "/cierre-caja" },
  { key: "alertas", label: "Alertas", href: "/#alertas" },
];

const PERMISSIONS: Record<CajaRole, CajaModule[]> = {
  ADMIN_GERALD: [
    "dashboard",
    "citas-hoy",
    "nueva-atencion",
    "registrar-salida",
    "comprobantes",
    "cierre-caja",
    "alertas",
  ],
  SOCIO: [
    "dashboard",
    "citas-hoy",
    "nueva-atencion",
    "registrar-salida",
    "comprobantes",
    "cierre-caja",
    "alertas",
  ],
  VITA_OPERACION: [
    "citas-hoy",
    "nueva-atencion",
    "registrar-salida",
    "cierre-caja",
  ],
};

function getSessionSecret() {
  return process.env.CAJA_SESSION_SECRET;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeCompare(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return timingSafeEqual(aBuffer, bBuffer);
}

function isCajaRole(value: unknown): value is CajaRole {
  return (
    value === "ADMIN_GERALD" ||
    value === "SOCIO" ||
    value === "VITA_OPERACION"
  );
}

export function createSessionToken(session: CajaSession) {
  const sessionSecret = getSessionSecret();

  if (!sessionSecret) {
    return "";
  }

  const payload = base64UrlEncode(JSON.stringify(session));
  const signature = signPayload(payload, sessionSecret);

  return `${payload}.${signature}`;
}

function parseSessionToken(token: string, sessionSecret: string): CajaSession | null {
  // Compatibilidad temporal con el login antiguo.
  // Si todavía existe una cookie vieja con el secret plano, entra como Gerald.
  if (token === sessionSecret) {
    return {
      usuario: "gerald",
      nombre: "Gerald",
      rol: "ADMIN_GERALD",
      iat: Date.now(),
    };
  }

  const [payload, signature] = token.split(".");

  if (!payload || !signature) {
    return null;
  }

  const expectedSignature = signPayload(payload, sessionSecret);

  if (!safeCompare(signature, expectedSignature)) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as CajaSession;

    if (!parsed.usuario || !parsed.nombre || !isCajaRole(parsed.rol)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export async function getSession() {
  const sessionSecret = getSessionSecret();

  if (!sessionSecret) {
    return null;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  return parseSessionToken(token, sessionSecret);
}

export async function requireAuth() {
  const sessionSecret = getSessionSecret();

  if (!sessionSecret) {
    redirect("/login?error=config");
  }

  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  return session;
}

export async function requireModuleAccess(moduleName: CajaModule) {
  const session = await requireAuth();

  if (!roleCanAccess(session.rol, moduleName)) {
    redirect(getDefaultPathForRole(session.rol));
  }

  return session;
}

export async function isLoggedIn() {
  const session = await getSession();
  return Boolean(session);
}

export function roleCanAccess(rol: CajaRole, moduleName: CajaModule) {
  return PERMISSIONS[rol]?.includes(moduleName) ?? false;
}

export function getVisibleNavItems(rol: CajaRole) {
  return NAV_ITEMS.filter((item) => roleCanAccess(rol, item.key));
}

export function getDefaultPathForRole(rol: CajaRole) {
  if (roleCanAccess(rol, "dashboard")) {
    return "/";
  }

  if (roleCanAccess(rol, "citas-hoy")) {
    return "/citas-hoy";
  }

  return "/login";
}

export const authCookieName = AUTH_COOKIE_NAME;

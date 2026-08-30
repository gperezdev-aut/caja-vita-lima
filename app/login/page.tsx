import { loginAction } from "@/app/actions";
import { isLoggedIn } from "@/lib/auth";
import { redirect } from "next/navigation";

type LoginSearchParams = Promise<{
  error?: string;
  loggedOut?: string;
}>;

function getMessage(error?: string, loggedOut?: string) {
  if (loggedOut) {
    return {
      type: "ok",
      text: "Sesión cerrada correctamente.",
    };
  }

  if (error === "missing") {
    return {
      type: "error",
      text: "Ingresa usuario y PIN para continuar.",
    };
  }

  if (error === "invalid") {
    return {
      type: "error",
      text: "Usuario o PIN incorrecto. Revisa e intenta otra vez.",
    };
  }

  if (error === "bloqueado") {
    return {
      type: "error",
      text: "Demasiados intentos fallidos, espera unos minutos e intenta de nuevo.",
    };
  }

  if (error === "db") {
    return {
      type: "error",
      text: "No se pudo validar el usuario en Supabase. Revisa conexión o tabla usuarios.",
    };
  }

  if (error === "config") {
    return {
      type: "error",
      text: "Faltan variables de entorno en Vercel: CAJA_SESSION_SECRET o conexión Supabase.",
    };
  }

  return null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: LoginSearchParams;
}) {
  const loggedIn = await isLoggedIn();

  if (loggedIn) {
    redirect("/");
  }

  const params = await searchParams;
  const message = getMessage(params?.error, params?.loggedOut);

  return (
    <main className="loginPage">
      <section className="loginCard">
        <p className="eyebrow">Vita Lima Spa</p>
        <h1>Caja Vita Lima</h1>
        <p className="subtitle">
          Acceso interno por usuario y PIN para caja, reportes y operación.
        </p>

        {message && (
          <div className={`loginMessage ${message.type}`}>{message.text}</div>
        )}

        <form action={loginAction} className="loginForm">
          <label htmlFor="usuario">Usuario</label>
          <input
            id="usuario"
            name="usuario"
            type="text"
            placeholder="gerald, luis, nati o vita"
            autoComplete="username"
            required
          />

          <label htmlFor="pin">PIN</label>
          <input
            id="pin"
            name="pin"
            type="password"
            inputMode="numeric"
            placeholder="Ingresa tu PIN"
            autoComplete="current-password"
            required
          />

          <button type="submit">Entrar a Caja</button>
        </form>

        <p className="loginHint">
          Usuarios activos: Gerald, Luis, Nati y Vita Operación. Los permisos por
          rol se aplicarán por módulos en la siguiente etapa.
        </p>
      </section>
    </main>
  );
}

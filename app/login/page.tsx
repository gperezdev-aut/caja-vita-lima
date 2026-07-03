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

  if (error === "invalid") {
    return {
      type: "error",
      text: "Contraseña incorrecta. Revisa e intenta otra vez.",
    };
  }

  if (error === "config") {
    return {
      type: "error",
      text: "Faltan variables de entorno en Vercel: CAJA_APP_PASSWORD o CAJA_SESSION_SECRET.",
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
          Acceso interno para revisar caja, reportes y alertas operativas.
        </p>

        {message && (
          <div className={`loginMessage ${message.type}`}>{message.text}</div>
        )}

        <form action={loginAction} className="loginForm">
          <label htmlFor="password">Contraseña de acceso</label>
          <input
            id="password"
            name="password"
            type="password"
            placeholder="Ingresa la contraseña"
            autoComplete="current-password"
            required
          />

          <button type="submit">Entrar a Caja</button>
        </form>

        <p className="loginHint">
          Este acceso es temporal. Luego se puede cambiar por usuarios y roles:
          Gerald, socio, caja y lectura.
        </p>
      </section>
    </main>
  );
}

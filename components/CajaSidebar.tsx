import Link from "next/link";
import { logoutAction } from "@/app/actions";
import type { CajaSession } from "@/lib/auth";
import { getVisibleNavItems } from "@/lib/auth";

function roleLabel(role: CajaSession["rol"]) {
  if (role === "ADMIN_GERALD") return "Administrador";
  if (role === "SOCIO") return "Socio";
  if (role === "VITA_OPERACION") return "Operación";
  return role;
}

export function CajaSidebar({ session }: { session: CajaSession }) {
  const navItems = getVisibleNavItems(session.rol);
  const moduleItems = navItems.filter((item) => item.key !== "dashboard" && item.key !== "alertas");

  return (
    <>
      <aside className="sidebar sidebarDesktop">
        <div>
          <p className="sidebarEyebrow">Vita Lima</p>
          <h2>Caja</h2>
        </div>

        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: "18px",
            padding: "14px",
            background: "white",
          }}
        >
          <span
            style={{
              display: "block",
              color: "var(--muted)",
              fontSize: "12px",
              fontWeight: 800,
              marginBottom: "6px",
            }}
          >
            Usuario
          </span>
          <strong style={{ display: "block" }}>{session.nombre}</strong>
          <small style={{ color: "var(--green)", fontWeight: 850 }}>
            {roleLabel(session.rol)}
          </small>
        </div>

        <nav className="nav" aria-label="Navegación principal">
          {navItems.map((item) => (
            <Link key={item.key} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="nextModules">
          <span>Módulos</span>
          {moduleItems.map((item) => (
            <p key={item.key}>{item.label}</p>
          ))}
        </div>

        <form action={logoutAction}>
          <button className="logoutButton" type="submit">
            Cerrar sesión
          </button>
        </form>
      </aside>

      <aside className="sidebarMobile">
        <details className="mobileMenuDetails">
          <summary className="mobileMenuSummary">
            <span className="mobileMenuBrand">
              <small>Vita Lima</small>
              <strong>Caja</strong>
            </span>

            <span className="mobileMenuIdentity">
              <strong>{session.nombre}</strong>
              <small>{roleLabel(session.rol)}</small>
            </span>

            <span className="mobileMenuLabel">Menú</span>
          </summary>

          <div className="mobileMenuContent">
            <nav className="mobileMenuNav" aria-label="Navegación principal">
              {navItems.map((item) => (
                <Link key={item.key} href={item.href}>
                  {item.label}
                </Link>
              ))}
            </nav>

            <form action={logoutAction}>
              <button
                className="logoutButton mobileMenuLogout"
                type="submit"
              >
                Cerrar sesión
              </button>
            </form>
          </div>
        </details>
      </aside>
    </>
  );
}

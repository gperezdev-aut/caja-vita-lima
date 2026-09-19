import Link from "next/link";
import Image from "next/image";
import { logoutAction } from "@/app/actions";
import type { CajaSession } from "@/lib/auth";
import { getVisibleNavItems } from "@/lib/auth";
import styles from "./CajaSidebar.module.css";

function roleLabel(role: CajaSession["rol"]) {
  if (role === "ADMIN_GERALD" || role === "SOCIO") return "Administración";
  if (role === "VITA_OPERACION") return "Operación";
  return role;
}

export function CajaSidebar({ session }: { session: CajaSession }) {
  const visibleItems = getVisibleNavItems(session.rol);
  const horariosItem = visibleItems.find((item) => item.key === "horarios");
  const cierreItem = visibleItems.find((item) => item.key === "cierre-caja");
  const navItems = [
    ...visibleItems.filter((item) => item.key !== "horarios" && item.key !== "cierre-caja"),
    ...(cierreItem ? [cierreItem] : []),
    ...(horariosItem ? [horariosItem] : []),
  ];
  const moduleItems = navItems.filter((item) => item.key !== "dashboard" && item.key !== "alertas");

  return (
    <>
      <aside className={`sidebar sidebarDesktop ${styles.desktopShell}`}>
        <div className="sidebarBrand">
          <Image
            className="sidebarLogo"
            src="/brand/logo-vita-lima-orange.png"
            alt="Vita Lima Spa"
            width={133}
            height={60}
            priority
          />
          <span>Caja operativa</span>
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
          <small style={{ color: "var(--muted)", fontWeight: 850 }}>
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

      <aside className={`sidebarMobile ${styles.mobileShell}`}>
        <details className={`${styles.mobileDetails} mobileMenuDetails`}>
          <summary className={styles.mobileSummary}>
            <span className={styles.brandBlock}>
              <Image
                src="/brand/logo-vita-lima-orange.png"
                alt="Vita Lima Spa"
                width={104}
                height={47}
                priority
              />
              <small>Caja</small>
            </span>

            <span className={styles.menuButton}>Menú</span>
          </summary>

          <div className={styles.mobileContent}>
            <span className={styles.identity}>
              <strong>{session.nombre}</strong>
              <small>{roleLabel(session.rol)}</small>
            </span>

            <nav className={styles.mobileNav} aria-label="Navegación principal">
              {navItems.map((item) => (
                <Link key={item.key} href={item.href}>
                  {item.label}
                </Link>
              ))}
            </nav>

            <form action={logoutAction}>
              <button className={styles.mobileLogout} type="submit">
                Cerrar sesión
              </button>
            </form>
          </div>
        </details>
      </aside>
    </>
  );
}

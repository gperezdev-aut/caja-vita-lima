import type { CSSProperties } from "react";
import Link from "next/link";
import { requireModuleAccess } from "@/lib/auth";
import { CajaSidebar } from "@/components/CajaSidebar";
import { supabaseSelect, supabaseSelectWhere } from "@/lib/supabaseServer";
import { Badge } from "@/components/Badge";
import { FormField } from "@/components/FormField";
import { Input } from "@/components/Input";
import { Select } from "@/components/Select";

type Row = Record<string, any>;

type SearchParams = Promise<{
  q?: string;
  estado?: string;
  actividad?: string;
  contacto?: string;
  sede?: string;
  tipo?: string;
}>;

function money(value: any) {
  const numberValue = Number(value ?? 0);

  return `S/ ${numberValue.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function numberFmt(value: any) {
  return Number(value ?? 0).toLocaleString("es-PE");
}

function dateShort(value: any) {
  if (!value) return "-";

  const date = new Date(`${value}T00:00:00`);

  return date.toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function safe(value: any) {
  const text = String(value ?? "").trim();
  return text || "-";
}

function waHref(value: any) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length > 9 && digits.startsWith("51")) {
    digits = digits.slice(2);
  }
  digits = digits.slice(-9);
  return `https://wa.me/51${digits}`;
}

function WhatsappCell({ value }: { value: any }) {
  const text = safe(value);
  if (text === "-") return <>{text}</>;

  return (
    <a href={waHref(value)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--green)" }}>
      {text}
    </a>
  );
}

function short(value: any, max = 72) {
  const text = safe(value);
  if (text === "-") return text;
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function norm(value: any) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

function list(config: Row[], name: string) {
  return config
    .filter((row) => row.lista === name && row.activo !== false)
    .sort((a, b) => Number(a.orden ?? 0) - Number(b.orden ?? 0));
}

function Options({
  rows,
  fallback,
}: {
  rows: Row[];
  fallback: string[];
}) {
  const values = rows.length ? rows.map((row) => String(row.valor)) : fallback;

  return (
    <>
      {values.map((value) => (
        <option key={value} value={value}>
          {value}
        </option>
      ))}
    </>
  );
}

function clienteHref(row: Row) {
  const clienteId = String(row.cliente_id ?? "").trim();

  if (!clienteId) {
    return "/clientes";
  }

  return `/clientes/${encodeURIComponent(clienteId)}`;
}

function getEstado(row: Row) {
  return safe(row.estado_cliente_crm ?? row.nivel_cliente_crm ?? row.segmento_cliente);
}

function getActividad(row: Row) {
  const explicit = String(row.estado_actividad_crm ?? "").trim();
  if (explicit) return explicit;

  const dias = Number(row.dias_sin_visita ?? 0);
  if (!row.ultima_visita && !row.ultima_reserva) return "Sin fecha";
  if (dias > 60) return "Inactivo";
  return "Activo";
}

function getContacto(row: Row) {
  const explicit = String(row.calidad_contacto_crm ?? "").trim();
  if (explicit) return explicit;

  if (String(row.whatsapp ?? "").trim()) return "Con WhatsApp";
  if (String(row.dni ?? "").trim() || String(row.email ?? "").trim()) {
    return "Con dato parcial";
  }
  return "Sin contacto";
}

function getSede(row: Row) {
  return safe(row.sede_frecuente ?? row.ultima_sede);
}

function getCatalogoTipo(row: Row) {
  return safe(row.servicio_mas_comprado_catalogo_tipo);
}

function getMenuGroup(row: Row) {
  return safe(row.servicio_mas_comprado_menu_group);
}

function getCatalogoNombre(row: Row) {
  return safe(row.servicio_mas_comprado_catalogo_nombre ?? row.servicio_mas_comprado);
}

function cardToneByEstado(value: any): "default" | "good" | "warn" | "danger" {
  const text = norm(value);

  if (text.includes("vip")) return "good";
  if (text.includes("inactivo")) return "danger";
  if (text.includes("recurrente")) return "warn";
  return "default";
}

function badgeTone(value: any): "default" | "good" | "warn" | "danger" {
  const text = norm(value);

  if (text.includes("vip") || text.includes("activo") || text.includes("whatsapp")) return "good";
  if (text.includes("inactivo") || text.includes("sin contacto")) return "danger";
  if (text.includes("recurrente") || text.includes("historico") || text.includes("histórico")) return "warn";
  return "default";
}

function Card({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "warn";
}) {
  return (
    <div className={`card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const buttonStyle: CSSProperties = {
  border: "0",
  borderRadius: "15px",
  padding: "13px 16px",
  background: "var(--green)",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "48px",
};

const ghostButtonStyle: CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: "15px",
  padding: "13px 16px",
  background: "white",
  color: "var(--green)",
  fontWeight: 900,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "48px",
};

function matchesTipo(row: Row, tipo: string) {
  if (tipo === "TODOS") return true;

  const catalogoTipo = String(row.servicio_mas_comprado_catalogo_tipo ?? "");
  const menuGroup = String(row.servicio_mas_comprado_menu_group ?? "");

  if (tipo === "CATALOGO") return catalogoTipo === "SERVICIO";
  if (tipo === "HISTORICO") {
    return catalogoTipo === "SERVICIO_HISTORICO" || catalogoTipo === "PROMO_HISTORICA";
  }
  if (tipo === "PACK_2P") return menuGroup === "PACK_2P";
  if (tipo === "PROMOS_1P") return menuGroup === "PROMOS_1P";
  if (tipo === "SESSIONS") return menuGroup === "SESSIONS";
  if (tipo === "GIFT_CARD") return catalogoTipo === "GIFT_CARD";

  return true;
}

function groupServices(rows: Row[]) {
  const groups = new Map<string, Row>();

  for (const row of rows) {
    const catalogoNombre = safe(row.catalogo_nombre ?? row.servicio);
    const catalogoTipo = safe(row.catalogo_tipo ?? row.tipo_linea_crm);
    const menuGroup = safe(row.catalogo_menu_group);
    const key = `${catalogoNombre}|${catalogoTipo}|${menuGroup}`;

    const current = groups.get(key) ?? {
      catalogo_nombre: catalogoNombre,
      catalogo_tipo: catalogoTipo,
      catalogo_menu_group: menuGroup,
      total_atenciones: 0,
      total_pax: 0,
      total_ingresado: 0,
      ultima_venta: row.ultima_venta,
    };

    current.total_atenciones += Number(row.total_atenciones ?? 0);
    current.total_pax += Number(row.total_pax ?? 0);
    current.total_ingresado += Number(row.total_ingresado ?? 0);

    if (String(row.ultima_venta ?? "") > String(current.ultima_venta ?? "")) {
      current.ultima_venta = row.ultima_venta;
    }

    current.ticket_promedio =
      current.total_atenciones > 0
        ? current.total_ingresado / current.total_atenciones
        : 0;

    groups.set(key, current);
  }

  return Array.from(groups.values()).sort(
    (a, b) => Number(b.total_ingresado ?? 0) - Number(a.total_ingresado ?? 0)
  );
}

export default async function ClientesPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireModuleAccess("clientes");
  const params = await searchParams;

  const q = String(params.q ?? "").trim();
  const estado = String(params.estado ?? "TODOS");
  const actividad = String(params.actividad ?? "TODOS");
  const contacto = String(params.contacto ?? "TODOS");
  const sede = String(params.sede ?? "TODAS");
  const tipo = String(params.tipo ?? "TODOS");

  const config = await supabaseSelect<Row>("config_listas");
  const sedeFallback = ["Miraflores", "San Borja"];
  const sedesRows = list(config.data, "SEDES");

  const clientesResult = await supabaseSelectWhere<Row>(
    "vista_clientes_crm_catalogo",
    ["select=*", "order=total_gastado.desc", "limit=1000"].join("&")
  );

  const serviciosResult = await supabaseSelectWhere<Row>(
    "vista_servicios_crm_catalogo",
    ["select=*", "order=total_ingresado.desc", "limit=300"].join("&")
  );

  const errors = [config.error, clientesResult.error, serviciosResult.error].filter(Boolean);

  let clientes = clientesResult.data ?? [];

  if (q) {
    const query = norm(q);
    clientes = clientes.filter((row) => {
      return (
        norm(row.cliente).includes(query) ||
        norm(row.whatsapp).includes(query) ||
        norm(row.dni).includes(query) ||
        norm(row.servicio_mas_comprado).includes(query) ||
        norm(row.servicio_mas_comprado_catalogo_nombre).includes(query)
      );
    });
  }

  if (estado !== "TODOS") {
    clientes = clientes.filter((row) => getEstado(row) === estado);
  }

  if (actividad !== "TODOS") {
    clientes = clientes.filter((row) => getActividad(row) === actividad);
  }

  if (contacto !== "TODOS") {
    clientes = clientes.filter((row) => getContacto(row) === contacto);
  }

  if (sede !== "TODAS") {
    clientes = clientes.filter((row) => getSede(row) === sede);
  }

  if (tipo !== "TODOS") {
    clientes = clientes.filter((row) => matchesTipo(row, tipo));
  }

  const serviciosBase = (serviciosResult.data ?? []).filter((row) => {
    if (sede !== "TODAS" && String(row.sede ?? "") !== sede) return false;

    const catalogoTipo = String(row.catalogo_tipo ?? "");
    const tipoLinea = String(row.tipo_linea_crm ?? "");

    return (
      ["SERVICIO", "SERVICIO_HISTORICO", "PROMO_HISTORICA"].includes(catalogoTipo) ||
      ["SERVICIO", "PACK", "PROMO"].includes(tipoLinea)
    );
  });

  const serviciosAgrupados = groupServices(serviciosBase);

  const totalClientes = clientes.length;
  const totalGastado = clientes.reduce(
    (sum, row) => sum + Number(row.total_gastado ?? 0),
    0
  );
  const totalVisitas = clientes.reduce(
    (sum, row) => sum + Number(row.total_visitas ?? row.total_reservas ?? 0),
    0
  );
  const conWhatsapp = clientes.filter((row) => getContacto(row) === "Con WhatsApp").length;
  const vipInactivos = clientes.filter(
    (row) => getEstado(row) === "VIP" && getActividad(row) === "Inactivo"
  ).length;
  const historicos = clientes.filter(
    (row) =>
      getCatalogoTipo(row) === "SERVICIO_HISTORICO" ||
      getCatalogoTipo(row) === "PROMO_HISTORICA"
  ).length;

  const clientesTop = [...clientes]
    .sort((a, b) => Number(b.total_gastado ?? 0) - Number(a.total_gastado ?? 0))
    .slice(0, 8);

  const clientesRecuperar = [...clientes]
    .filter((row) => getActividad(row) === "Inactivo" || getEstado(row) === "Inactivo")
    .sort((a, b) => Number(b.total_gastado ?? 0) - Number(a.total_gastado ?? 0))
    .slice(0, 10);

  const serviciosTop = serviciosAgrupados.slice(0, 10);

  return (
    <main className="appShell">
      <CajaSidebar session={session} />

      <section className="page clientesPage">
        <section className="hero" style={{ minHeight: "150px" }}>
          <div>
            <p className="eyebrow">CRM Vita Lima</p>
            <h1>Clientes</h1>
            <p className="subtitle">
              Vista comercial de clientes, visitas, gasto histórico, servicios favoritos y recuperación.
            </p>
          </div>

          <div className="badge">
            <span>Clientes</span>
            <strong>{numberFmt(totalClientes)}</strong>
          </div>
        </section>

        {errors.length > 0 && (
          <div className="alert">
            <strong>Revisar conexión:</strong>
            <ul>
              {errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        <section className="panel">
          <div className="panelTitle">
            <div>
              <h2>Filtros CRM</h2>
              <p>Busca por cliente, WhatsApp, DNI, servicio o tipo comercial.</p>
            </div>
          </div>

          <form
            method="GET"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "14px",
              alignItems: "end",
            }}
          >
            <FormField label="Buscar">
              <Input
                name="q"
                defaultValue={q}
                placeholder="Ej. María, 987..., Royale"
                className="formControlEmphasis"
              />
            </FormField>

            <FormField label="Estado CRM">
              <Select name="estado" defaultValue={estado} className="formControlEmphasis">
                <option value="TODOS">Todos</option>
                <option value="VIP">VIP</option>
                <option value="Recurrente">Recurrente</option>
                <option value="Nuevo">Nuevo</option>
                <option value="Inactivo">Inactivo</option>
                <option value="Reservó">Reservó</option>
                <option value="Sin historial">Sin historial</option>
              </Select>
            </FormField>

            <FormField label="Actividad">
              <Select name="actividad" defaultValue={actividad} className="formControlEmphasis">
                <option value="TODOS">Todos</option>
                <option value="Activo">Activo</option>
                <option value="Inactivo">Inactivo</option>
                <option value="Sin fecha">Sin fecha</option>
              </Select>
            </FormField>

            <FormField label="Contacto">
              <Select name="contacto" defaultValue={contacto} className="formControlEmphasis">
                <option value="TODOS">Todos</option>
                <option value="Con WhatsApp">Con WhatsApp</option>
                <option value="Con dato parcial">Con dato parcial</option>
                <option value="Histórico sin contacto">Histórico sin contacto</option>
                <option value="Sin contacto">Sin contacto</option>
              </Select>
            </FormField>

            <FormField label="Sede">
              <Select name="sede" defaultValue={sede} className="formControlEmphasis">
                <option value="TODAS">Todas</option>
                <Options rows={sedesRows} fallback={sedeFallback} />
              </Select>
            </FormField>

            <FormField label="Tipo">
              <Select name="tipo" defaultValue={tipo} className="formControlEmphasis">
                <option value="TODOS">Todos</option>
                <option value="CATALOGO">Catálogo actual</option>
                <option value="PROMOS_1P">Promos 1 persona</option>
                <option value="PACK_2P">Packs 2 personas</option>
                <option value="SESSIONS">Programas / sesiones</option>
                <option value="HISTORICO">Históricos</option>
                <option value="GIFT_CARD">Gift Card</option>
              </Select>
            </FormField>

            <button type="submit" style={buttonStyle}>
              Aplicar
            </button>

            <Link href="/clientes" style={ghostButtonStyle}>
              Ver todo
            </Link>
          </form>
        </section>

        <section className="grid secondary">
          <Card label="Clientes filtrados" value={numberFmt(totalClientes)} tone="good" />
          <Card label="Total gastado" value={money(totalGastado)} tone="good" />
          <Card label="Visitas registradas" value={numberFmt(totalVisitas)} />
          <Card label="VIP inactivos" value={numberFmt(vipInactivos)} tone="warn" />
        </section>

        <section className="grid secondary">
          <Card label="Con WhatsApp" value={numberFmt(conWhatsapp)} />
          <Card
            label="Ticket promedio"
            value={money(totalVisitas > 0 ? totalGastado / totalVisitas : 0)}
          />
          <Card label="Clientes históricos" value={numberFmt(historicos)} tone="warn" />
          <Card label="Servicios agrupados" value={numberFmt(serviciosAgrupados.length)} />
        </section>

        <section className="twoCols">
          <div className="panel">
            <div className="panelTitle">
              <div>
                <h2>Top clientes</h2>
                <p>Clientes ordenados por gasto histórico.</p>
              </div>
            </div>

            <div className="miniList">
              {clientesTop.length === 0 && (
                <div className="miniItem">
                  <span>No hay clientes para este filtro</span>
                  <strong>-</strong>
                </div>
              )}

              {clientesTop.map((row, index) => (
                <div className="miniItem" key={`${row.cliente_id ?? row.cliente}-${index}`}>
                  <span>
                    <Link href={clienteHref(row)} className="crmLink">
                      {safe(row.cliente)}
                    </Link>{" "}
                    · {getEstado(row)} · {short(getCatalogoNombre(row), 34)}
                  </span>
                  <strong>{money(row.total_gastado)}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panelTitle">
              <div>
                <h2>Servicios más vendidos</h2>
                <p>Agrupado por catálogo actual e históricos.</p>
              </div>
            </div>

            <div className="miniList">
              {serviciosTop.length === 0 && (
                <div className="miniItem">
                  <span>No hay servicios para este filtro</span>
                  <strong>-</strong>
                </div>
              )}

              {serviciosTop.map((row, index) => (
                <div className="miniItem" key={`${row.catalogo_nombre}-${index}`}>
                  <span>
                    {short(row.catalogo_nombre, 48)} · {safe(row.catalogo_menu_group)}
                  </span>
                  <strong>
                    {money(row.total_ingresado)} / {numberFmt(row.total_atenciones)}
                  </strong>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panelTitle">
            <div>
              <h2>Clientes para recuperar</h2>
              <p>Inactivos ordenados por valor histórico.</p>
            </div>
          </div>

          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>WhatsApp</th>
                  <th>Última visita</th>
                  <th>Días</th>
                  <th>Estado</th>
                  <th>Servicio catálogo</th>
                  <th>Tipo</th>
                  <th>Visitas</th>
                  <th>Total gastado</th>
                </tr>
              </thead>
              <tbody>
                {clientesRecuperar.length === 0 && (
                  <tr>
                    <td colSpan={9}>No hay clientes inactivos para este filtro.</td>
                  </tr>
                )}

                {clientesRecuperar.map((row, index) => (
                  <tr key={`${row.cliente_id ?? row.cliente}-rec-${index}`}>
                    <td className="strong">
                      <Link href={clienteHref(row)} className="crmLink">
                        {safe(row.cliente)}
                      </Link>
                    </td>
                    <td><WhatsappCell value={row.whatsapp} /></td>
                    <td>{dateShort(row.ultima_visita ?? row.ultima_reserva)}</td>
                    <td>{safe(row.dias_sin_visita)}</td>
                    <td>
                      <Badge tone={cardToneByEstado(getEstado(row))}>{getEstado(row)}</Badge>
                    </td>
                    <td>{short(getCatalogoNombre(row), 70)}</td>
                    <td>
                      <Badge tone={badgeTone(getCatalogoTipo(row))}>{getCatalogoTipo(row)}</Badge>
                    </td>
                    <td>{numberFmt(row.total_visitas ?? row.total_reservas)}</td>
                    <td className="strong">{money(row.total_gastado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panelTitle">
            <div>
              <h2>Base de clientes</h2>
              <p>Resumen CRM general cruzado con catálogo.</p>
            </div>
          </div>

          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>WhatsApp</th>
                  <th>Última visita</th>
                  <th>Estado CRM</th>
                  <th>Actividad</th>
                  <th>Contacto</th>
                  <th>Sede</th>
                  <th>Servicio histórico</th>
                  <th>Servicio catálogo</th>
                  <th>Grupo</th>
                  <th>Visitas</th>
                  <th>Total gastado</th>
                  <th>Ticket</th>
                </tr>
              </thead>
              <tbody>
                {clientes.length === 0 && (
                  <tr>
                    <td colSpan={13}>No hay clientes con los filtros seleccionados.</td>
                  </tr>
                )}

                {clientes.map((row, index) => (
                  <tr key={`${row.cliente_id ?? row.cliente}-base-${index}`}>
                    <td className="strong">
                      <Link href={clienteHref(row)} className="crmLink">
                        {safe(row.cliente)}
                      </Link>
                    </td>
                    <td><WhatsappCell value={row.whatsapp} /></td>
                    <td>{dateShort(row.ultima_visita ?? row.ultima_reserva)}</td>
                    <td>
                      <Badge tone={cardToneByEstado(getEstado(row))}>{getEstado(row)}</Badge>
                    </td>
                    <td>{getActividad(row)}</td>
                    <td>{getContacto(row)}</td>
                    <td>{getSede(row)}</td>
                    <td>{short(row.servicio_mas_comprado, 60)}</td>
                    <td>{short(getCatalogoNombre(row), 60)}</td>
                    <td>{getMenuGroup(row)}</td>
                    <td>{numberFmt(row.total_visitas ?? row.total_reservas)}</td>
                    <td className="strong">{money(row.total_gastado)}</td>
                    <td>{money(row.ticket_promedio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      <style>
        {`
          .crmLink {
            color: var(--green);
            font-weight: 950;
            text-decoration: none;
          }

          .crmLink:hover {
            text-decoration: underline;
          }
        `}
      </style>
    </main>
  );
}

import { CajaSidebar } from "@/components/CajaSidebar";
import { Badge } from "@/components/Badge";
import { requireModuleAccess } from "@/lib/auth";
import { supabaseSelectWhere } from "@/lib/supabaseServer";
import { CuponValidationForm, type ConvenioBenefit } from "./CuponValidationForm";
import styles from "./CuponesPage.module.css";

type Row = Record<string, unknown>;
type SearchParams = Promise<{ proveedor?: string; estado?: string; q?: string }>;
type CouponStateCounts = {
  esperando: number;
  declarado: number;
  verificado: number;
  canjeado: number;
};

function providerLabel(canal: string) {
  return canal === "cuponidad" ? "Cuponidad" : "Bee Beneficios";
}

function providerCode(canal: string): "cuponidad" | "bee" | null {
  if (canal === "cuponidad" || canal === "bee") return canal;
  return null;
}

function statusLabel(estado: string) {
  if (estado === "esperando") return "Esperando ficha";
  if (estado === "declarado") return "Cupón registrado";
  if (estado === "verificado") return "Verificado";
  if (estado === "canjeado") return "Canjeado";
  return estado || "-";
}

function statusTone(estado: string): "good" | "warn" | "danger" | undefined {
  if (estado === "verificado" || estado === "canjeado") return "good";
  if (estado === "declarado" || estado === "esperando") return "warn";
  return undefined;
}

function dateLabel(value: unknown) {
  const raw = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw || "-";
  return new Intl.DateTimeFormat("es-PE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "America/Lima",
  }).format(new Date(`${raw}T12:00:00-05:00`));
}

function hourLabel(value: unknown) {
  return value ? String(value).slice(0, 5) : "-";
}

function waHref(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits.length === 9 ? `51${digits}` : digits}` : "";
}

export default async function CuponesPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireModuleAccess("cupones");
  const params = await searchParams;
  const proveedorFiltro = ["cuponidad", "bee"].includes(String(params.proveedor ?? ""))
    ? String(params.proveedor)
    : "todos";
  const estadoFiltro = ["esperando", "declarado", "verificado", "canjeado"].includes(String(params.estado ?? ""))
    ? String(params.estado)
    : "todos";
  const query = String(params.q ?? "").trim().toLocaleLowerCase("es-PE");

  const [reservasResult, cuponesResult, benefitsResult] = await Promise.all([
    supabaseSelectWhere<Row>(
      "citas_reservadas",
      "select=reserva_id,fecha_cita,hora_cita,sede,cliente_id,cliente,whatsapp,n_pax,personas,servicio,duracion_min,monto_total,saldo_pendiente,canal,estado_ficha,source_id,service_code,created_at&canal=in.(cuponidad,bee)&order=fecha_cita.desc,hora_cita.desc&limit=300"
    ),
    supabaseSelectWhere<Row>(
      "cupones_convenios",
      "select=registro_id,reserva_id,fecha,sede,plataforma,codigo_cupon,cliente,whatsapp,n_pax,servicio,beneficio_code,sesiones_total,estado,responsable,observacion,created_at&order=created_at.desc&limit=500"
    ),
    supabaseSelectWhere<Row>(
      "caja_convenio_beneficios",
      "select=beneficio_code,proveedor,nombre,incluido,duracion_min,sesiones_total,sede_restringida,activo,orden&activo=eq.true&order=proveedor.asc,orden.asc"
    ),
  ]);

  const couponByReserva = new Map(
    cuponesResult.data
      .filter((row) => String(row.reserva_id ?? ""))
      .map((row) => [String(row.reserva_id), row])
  );

  const benefits: ConvenioBenefit[] = benefitsResult.data
    .map((row) => ({
      code: String(row.beneficio_code ?? ""),
      provider: String(row.proveedor ?? "") as ConvenioBenefit["provider"],
      name: String(row.nombre ?? ""),
      included: String(row.incluido ?? ""),
      duration: Number(row.duracion_min ?? 0),
      sessions: Number(row.sesiones_total ?? 1),
      restrictedBranch: String(row.sede_restringida ?? ""),
    }))
    .filter((benefit) =>
      Boolean(benefit.code) &&
      Boolean(benefit.name) &&
      ["cuponidad", "bee"].includes(benefit.provider) &&
      benefit.duration > 0 &&
      benefit.sessions > 0
    );

  const rows = reservasResult.data
    .map((reserva) => {
      const coupon = couponByReserva.get(String(reserva.reserva_id ?? ""));
      const estado = coupon ? String(coupon.estado ?? "declarado") : "esperando";
      const canal = String(reserva.canal ?? "");
      const searchable = [
        reserva.cliente,
        reserva.whatsapp,
        reserva.sede,
        reserva.servicio,
        coupon?.codigo_cupon,
        coupon?.plataforma,
      ].map((value) => String(value ?? "").toLocaleLowerCase("es-PE")).join(" ");
      return { reserva, coupon, estado, canal, searchable };
    })
    .filter((item) => proveedorFiltro === "todos" || item.canal === proveedorFiltro)
    .filter((item) => estadoFiltro === "todos" || item.estado === estadoFiltro)
    .filter((item) => !query || item.searchable.includes(query));

  const totals = reservasResult.data.reduce<CouponStateCounts>(
    (acc, reserva) => {
      const coupon = couponByReserva.get(String(reserva.reserva_id ?? ""));
      const estado = coupon ? String(coupon.estado ?? "declarado") : "esperando";
      if (estado === "esperando") acc.esperando += 1;
      else if (estado === "declarado") acc.declarado += 1;
      else if (estado === "verificado") acc.verificado += 1;
      else if (estado === "canjeado") acc.canjeado += 1;
      return acc;
    },
    { esperando: 0, declarado: 0, verificado: 0, canjeado: 0 }
  );

  const errors = [
    reservasResult.error,
    cuponesResult.error,
    benefitsResult.error,
  ].filter(Boolean);

  return (
    <main className="appShell">
      <CajaSidebar session={session} />
      <section className={`page ${styles.page}`}>
        <section className="hero" style={{ minHeight: 145 }}>
          <div>
            <p className="eyebrow">Convenios</p>
            <h1>Cupones</h1>
            <p className="subtitle">
              Seguimiento operativo de Cuponidad y Bee Beneficios. Primero identifica el servicio; la parte económica se definirá después.
            </p>
          </div>
          <div className="badge">
            <span>En bandeja</span>
            <strong>{reservasResult.data.length}</strong>
          </div>
        </section>

        <section className={styles.summaryGrid}>
          <div className={styles.summaryCard}><span>Esperando ficha</span><strong>{totals.esperando}</strong></div>
          <div className={styles.summaryCard}><span>Registrados</span><strong>{totals.declarado}</strong></div>
          <div className={styles.summaryCard}><span>Verificados</span><strong>{totals.verificado}</strong></div>
          <div className={styles.summaryCard}><span>Canjeados</span><strong>{totals.canjeado}</strong></div>
        </section>

        <section className="panel" style={{ marginBottom: 18 }}>
          <div className="panelTitle">
            <div><h2>Filtrar cupones</h2><p>Busca por cliente, WhatsApp, código o sede.</p></div>
          </div>
          <form method="GET" action="/cupones" className={styles.filters}>
            <label>
              Proveedor
              <select name="proveedor" defaultValue={proveedorFiltro}>
                <option value="todos">Todos</option>
                <option value="cuponidad">Cuponidad</option>
                <option value="bee">Bee Beneficios</option>
              </select>
            </label>
            <label>
              Estado
              <select name="estado" defaultValue={estadoFiltro}>
                <option value="todos">Todos</option>
                <option value="esperando">Esperando ficha</option>
                <option value="declarado">Cupón registrado</option>
                <option value="verificado">Verificado</option>
                <option value="canjeado">Canjeado</option>
              </select>
            </label>
            <label>
              Buscar
              <input name="q" type="search" defaultValue={String(params.q ?? "")} placeholder="Cliente, código, WhatsApp…" />
            </label>
            <button type="submit" className="primaryButton">Aplicar</button>
          </form>
        </section>

        {errors.length > 0 && (
          <div className="alert">
            No se pudo cargar parte de la bandeja de cupones. Administración debe revisar la conexión.
          </div>
        )}

        <section className={styles.list}>
          {rows.map(({ reserva, coupon, estado, canal }) => {
            const registroId = String(coupon?.registro_id ?? "");
            const cliente = String(reserva.cliente ?? coupon?.cliente ?? "").trim() || "Cliente pendiente";
            const whatsapp = String(reserva.whatsapp ?? coupon?.whatsapp ?? "").trim();
            const service = estado === "esperando"
              ? "Beneficio pendiente de identificar"
              : String(coupon?.servicio ?? reserva.servicio ?? "").trim() || "Servicio pendiente";
            const provider = providerCode(canal);
            const currentBenefitCode = String(coupon?.beneficio_code ?? "");
            const sessionsTotal = Number(coupon?.sesiones_total ?? 0);
            return (
              <article key={String(reserva.reserva_id)} className={styles.couponCard}>
                <div className={styles.cardHeader}>
                  <div>
                    <span className={styles.provider}>{providerLabel(canal)}</span>
                    <h3>{cliente}</h3>
                  </div>
                  <Badge tone={statusTone(estado)}>{statusLabel(estado)}</Badge>
                </div>

                <div className={styles.meta}>
                  <div><span>Fecha</span><strong>{dateLabel(reserva.fecha_cita)}</strong></div>
                  <div><span>Hora</span><strong>{hourLabel(reserva.hora_cita)}</strong></div>
                  <div><span>Sede</span><strong>{String(reserva.sede ?? "-")}</strong></div>
                  <div><span>Ficha</span><strong>{String(reserva.estado_ficha ?? "-") === "completa" ? "Completa" : "Pendiente"}</strong></div>
                </div>

                {whatsapp && (
                  <div>
                    <a className="ghostButton" href={waHref(whatsapp)} target="_blank" rel="noopener noreferrer">
                      WhatsApp · {whatsapp}
                    </a>
                  </div>
                )}

                {coupon?.codigo_cupon ? (
                  <div className={styles.codeBox}>
                    <span>Código del cliente</span>
                    <code>{String(coupon.codigo_cupon)}</code>
                  </div>
                ) : (
                  <div className={styles.codeBox}>
                    <span>Código del cliente</span>
                    <strong>Aún no enviado</strong>
                  </div>
                )}

                <div className={styles.meta}>
                  <div><span>Servicio</span><strong>{service}</strong></div>
                  {sessionsTotal > 1 && (
                    <div><span>Sesiones incluidas</span><strong>{sessionsTotal} sesiones · duración por sesión</strong></div>
                  )}
                </div>

                {estado === "declarado" && registroId && provider && (
                  <details className={styles.validationDetails} open={!currentBenefitCode}>
                    <summary>{currentBenefitCode ? "Cambiar servicio del convenio" : "Seleccionar servicio del convenio"}</summary>
                    <CuponValidationForm
                      registroId={registroId}
                      provider={provider}
                      benefits={benefits}
                      currentBenefitCode={currentBenefitCode}
                    />
                  </details>
                )}

                {estado === "verificado" && (
                  <div className="formMessage ok">
                    Cupón verificado. Ya puede iniciarse la atención desde Citas de hoy; la cobertura se aplicará al cerrar la atención.
                  </div>
                )}

                {estado === "canjeado" && (
                  <div className="formMessage ok">
                    Cupón canjeado y conciliado. Cualquier pago adicional queda registrado aparte como ingreso de Vita Lima.
                  </div>
                )}
              </article>
            );
          })}

          {!rows.length && (
            <section className={`panel ${styles.empty}`}>
              <h2>No hay cupones con estos filtros</h2>
              <p>Prueba cambiando proveedor, estado o búsqueda.</p>
            </section>
          )}
        </section>
      </section>
    </main>
  );
}

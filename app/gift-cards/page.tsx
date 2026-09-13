import { randomUUID } from "crypto";
import { CajaSidebar } from "@/components/CajaSidebar";
import { requireModuleAccess } from "@/lib/auth";
import { leerCatalogoPrepararCita } from "@/lib/catalogoPrepararCita";
import { formatGiftCardDate } from "@/lib/giftCards";
import { supabaseSelect, supabaseSelectWhere } from "@/lib/supabaseServer";
import { GiftCardsModule } from "./GiftCardsModule";

type Row = Record<string, unknown>;
type SearchParams = Promise<{ codigo?: string; estado?: string; tipo?: string; desde?: string; hasta?: string; beneficiario?: string; whatsapp?: string; ok?: string; error?: string }>;

function todayInLima() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function money(value: unknown) {
  return `S/ ${Number(value ?? 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function filterValue(value: string) { return encodeURIComponent(value.replace(/[,*()]/g, "").slice(0, 80)); }

export default async function GiftCardsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireModuleAccess("gift-cards");
  const params = await searchParams;
  const filters = [
    "select=giftcard_id,codigo,destinatario,tipo,service_name_snapshot,monto,fecha_emision,fecha_vencimiento,saldo_restante,estado_efectivo",
    "order=created_at.desc", "limit=300",
  ];
  if (params.codigo) filters.push(`codigo=ilike.*${filterValue(params.codigo.toUpperCase())}*`);
  if (params.estado) filters.push(`estado_efectivo=eq.${filterValue(params.estado)}`);
  if (params.tipo) filters.push(`tipo=eq.${filterValue(params.tipo)}`);
  if (params.desde) filters.push(`fecha_emision=gte.${filterValue(params.desde)}`);
  if (params.hasta) filters.push(`fecha_emision=lte.${filterValue(params.hasta)}`);
  if (params.beneficiario) filters.push(`destinatario=ilike.*${filterValue(params.beneficiario)}*`);
  if (params.whatsapp) {
    const phone = filterValue(params.whatsapp.replace(/\D/g, ""));
    filters.push(`or=(whatsapp_comprador.ilike.*${phone}*,whatsapp_beneficiario.ilike.*${phone}*)`);
  }

  const [catalog, config, branchesResult, clientsResult, cardsResult] = await Promise.all([
    leerCatalogoPrepararCita(), supabaseSelect<Row>("config_listas"), supabaseSelect<Row>("sedes"),
    supabaseSelectWhere<Row>("clientes", "select=cliente_id,cliente,whatsapp&order=cliente.asc&limit=300"),
    supabaseSelectWhere<Row>("vista_gift_cards_operativa", filters.join("&")),
  ]);
  const methods = config.data.filter((row) => row.lista === "METODOS_PAGO" && row.activo !== false).sort((a,b) => Number(a.orden ?? 0)-Number(b.orden ?? 0)).map((row) => String(row.valor ?? "").trim()).filter(Boolean);
  const branches = branchesResult.data.filter((row) => row.activo !== false).map((row) => String(row.nombre ?? "").trim()).filter(Boolean);
  const clients = clientsResult.data.map((row) => ({ id: String(row.cliente_id ?? ""), name: String(row.cliente ?? ""), whatsapp: String(row.whatsapp ?? "") })).filter((row) => row.id && row.name);
  const services = catalog.ok ? catalog.services.map((service) => ({ code: service.serviceCode, name: service.nameEs, duration: service.durationMin, price: service.pricePen })).sort((a,b) => a.name.localeCompare(b.name,"es")) : [];
  const cards = cardsResult.data.map((row) => ({
    giftcard_id:String(row.giftcard_id??""), codigo:String(row.codigo??""), destinatario:String(row.destinatario??""), tipo:String(row.tipo??""), service_name_snapshot:String(row.service_name_snapshot??""), monto:Number(row.monto??0), fecha_emision:String(row.fecha_emision??""), fecha_vencimiento:String(row.fecha_vencimiento??""), saldo_restante:Number(row.saldo_restante??0), estado_efectivo:String(row.estado_efectivo??"EMITIDA"),
  }));
  const catalogError = "error" in catalog ? catalog.error : "";
  const error = catalogError || config.error || branchesResult.error || clientsResult.error || cardsResult.error || (!methods.length ? "No hay métodos de pago activos." : "") || (!branches.length ? "No hay sedes activas." : "");

  return <main className="appShell"><CajaSidebar session={session}/><section className="page giftCardsPage">
    <section className="hero giftCardsHero"><div><p className="eyebrow">Beneficios Vita Lima</p><h1>Gift Cards</h1><p className="subtitle">Emite, consulta y canjea Gift Cards sin duplicar ingresos.</p></div><div className="badge"><span>Registradas</span><strong>{cards.length}</strong></div></section>
    {params.ok && <div className="formMessage success" role="status">Operación completada para {params.codigo || "la Gift Card"}.</div>}
    {params.error && <div className="formMessage error" role="alert">{params.error}</div>}
    {error ? (
      <div className="formMessage error" role="alert">No se puede operar Gift Cards: {error}</div>
    ) : (
      <GiftCardsModule services={services} clients={clients} methods={methods} branches={branches} requestId={randomUUID()} today={todayInLima()}/>
    )}
    <section className="panel giftCardHistory"><div className="panelTitle"><div><p className="eyebrow">Consulta compacta</p><h2>Historial</h2></div></div>
      <form className="giftCardFilters" method="get"><label>Código<input name="codigo" defaultValue={params.codigo}/></label><label>Estado<select name="estado" defaultValue={params.estado}><option value="">Todos</option>{["EMITIDA","PARCIALMENTE_USADA","USADA","VENCIDA","ANULADA"].map((value)=><option key={value}>{value}</option>)}</select></label><label>Tipo<select name="tipo" defaultValue={params.tipo}><option value="">Todos</option><option value="SERVICIO">Servicio</option><option value="MONTO">Monto</option></select></label><label>Desde<input type="date" name="desde" defaultValue={params.desde}/></label><label>Hasta<input type="date" name="hasta" defaultValue={params.hasta}/></label><label>Beneficiario<input name="beneficiario" defaultValue={params.beneficiario}/></label><label>WhatsApp<input name="whatsapp" inputMode="tel" defaultValue={params.whatsapp}/></label><button className="primaryButton" type="submit">Aplicar filtros</button></form>
      {cards.length === 0 ? <p className="emptyState">No hay Gift Cards para estos filtros.</p> : <><section className="giftCardMobileList">{cards.map((card) => <a className="giftCardListCard" href={`/gift-cards/${encodeURIComponent(card.giftcard_id)}`} key={card.giftcard_id}><div><code>{card.codigo}</code><h3>{card.destinatario}</h3><p>{card.tipo === "SERVICIO" ? card.service_name_snapshot : money(card.monto)}</p></div><span className={`giftCardStatus status-${card.estado_efectivo}`}>{card.estado_efectivo.replaceAll("_", " ")}</span><dl><div><dt>Emitida</dt><dd>{formatGiftCardDate(card.fecha_emision)}</dd></div><div><dt>Vence</dt><dd>{formatGiftCardDate(card.fecha_vencimiento)}</dd></div>{card.tipo === "MONTO" && <div><dt>Saldo</dt><dd>{money(card.saldo_restante)}</dd></div>}</dl></a>)}</section><div className="desktopData"><table><thead><tr><th>Código</th><th>Beneficiario</th><th>Tipo / regalo</th><th>Emisión</th><th>Vence</th><th>Saldo</th><th>Estado</th></tr></thead><tbody>{cards.map((card)=><tr key={card.giftcard_id}><td><a href={`/gift-cards/${encodeURIComponent(card.giftcard_id)}`}><code>{card.codigo}</code></a></td><td>{card.destinatario}</td><td>{card.tipo === "SERVICIO" ? card.service_name_snapshot : money(card.monto)}</td><td>{formatGiftCardDate(card.fecha_emision)}</td><td>{formatGiftCardDate(card.fecha_vencimiento)}</td><td>{card.tipo === "MONTO" ? money(card.saldo_restante) : "Uso único"}</td><td><span className={`giftCardStatus status-${card.estado_efectivo}`}>{card.estado_efectivo.replaceAll("_"," ")}</span></td></tr>)}</tbody></table></div></>}
    </section>
  </section></main>;
}

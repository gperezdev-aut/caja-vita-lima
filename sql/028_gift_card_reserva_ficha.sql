-- Gift Card -> reserva/ficha -> atención/canje, con hold auditable.
-- Aplicar manualmente después de 027. Este archivo no contacta Supabase remoto.
begin;

create table if not exists public.gift_card_reservas (
  id uuid primary key default extensions.gen_random_uuid(),
  giftcard_id text not null references public.gift_cards(giftcard_id) on delete restrict,
  reserva_id text not null references public.citas_reservadas(reserva_id) on delete restrict,
  movimiento_id text not null references public.caja_movimientos(movimiento_id) on delete restrict,
  monto_reservado numeric(12,2) not null check (monto_reservado > 0),
  estado text not null default 'ACTIVA' check (estado in ('ACTIVA','LIBERADA','CANJEADA')),
  responsable text not null check (btrim(responsable) <> ''),
  request_id uuid not null unique,
  request_fingerprint text not null,
  created_at timestamptz not null default clock_timestamp(),
  released_at timestamptz,
  released_by text,
  release_request_id uuid,
  release_request_fingerprint text,
  redeemed_at timestamptz,
  uso_id uuid references public.gift_card_usos(uso_id) on delete restrict,
  constraint gift_card_reserva_terminal_check check (
    (estado='ACTIVA' and released_at is null and redeemed_at is null) or
    (estado='LIBERADA' and released_at is not null and redeemed_at is null) or
    (estado='CANJEADA' and released_at is null and redeemed_at is not null and uso_id is not null)
  )
);
create unique index if not exists gift_card_reservas_reserva_unique on public.gift_card_reservas(reserva_id);
create unique index if not exists gift_card_reservas_movimiento_unique on public.gift_card_reservas(movimiento_id);
create unique index if not exists gift_card_reservas_release_request_unique on public.gift_card_reservas(release_request_id) where release_request_id is not null;
create index if not exists gift_card_reservas_giftcard_estado_idx on public.gift_card_reservas(giftcard_id,estado);

alter table public.gift_card_reservas enable row level security;
revoke all on table public.gift_card_reservas from public,anon,authenticated;
grant select,insert,update on table public.gift_card_reservas to service_role;

create or replace view public.vista_gift_cards_operativa as
select g.*,
  case when g.estado not in ('ANULADA','USADA') and g.fecha_vencimiento < (now() at time zone 'America/Lima')::date then 'VENCIDA' else g.estado end estado_efectivo,
  greatest(coalesce(g.monto,0)-coalesce(u.total_usado,0),0)::numeric(12,2) saldo_restante,
  coalesce(u.total_usado,0)::numeric(12,2) total_usado,
  coalesce(u.cantidad_usos,0)::integer cantidad_usos,
  coalesce(h.total_reservado,0)::numeric(12,2) saldo_comprometido,
  greatest(coalesce(g.monto,0)-coalesce(u.total_usado,0)-coalesce(h.total_reservado,0),0)::numeric(12,2) saldo_disponible
from public.gift_cards g
left join lateral (select sum(monto_usado) total_usado,count(*) cantidad_usos from public.gift_card_usos where giftcard_id=g.giftcard_id) u on true
left join lateral (select sum(monto_reservado) total_reservado from public.gift_card_reservas where giftcard_id=g.giftcard_id and estado='ACTIVA') h on true;

create or replace function public.preparar_ficha_cita_gift_card_v1(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_request uuid; v_fingerprint text; v_existing public.gift_card_reservas%rowtype; v_gift public.gift_cards%rowtype;
  v_catalog public.caja_catalog_services%rowtype; v_resuelto jsonb; v_servicios jsonb; v_codigos jsonb;
  v_fecha date:=(p_payload->>'fecha')::date; v_hora time:=(p_payload->>'hora')::time;
  v_sede text:=btrim(coalesce(p_payload->>'sede','')); v_cliente text:=btrim(coalesce(p_payload->>'cliente',''));
  v_whatsapp text:=btrim(coalesce(p_payload->>'whatsapp_e164','')); v_pais text:=upper(btrim(coalesce(p_payload->>'pais_telefono','')));
  v_responsable text:=btrim(coalesce(p_payload->>'responsable','')); v_personas int:=coalesce((p_payload->>'personas')::int,0);
  v_pagado numeric(12,2):=coalesce((p_payload->>'monto_pagado')::numeric,0); v_metodo text:=upper(btrim(coalesce(p_payload->>'metodo_pago','')));
  v_operacion text:=btrim(coalesce(p_payload->>'numero_operacion','')); v_total numeric(12,2); v_subtotal numeric(12,2);
  v_usado numeric(12,2); v_comprometido numeric(12,2); v_disponible numeric(12,2); v_cobertura numeric(12,2); v_adelanto numeric(12,2); v_efectivo_min numeric(12,2);
  v_duracion int; v_resumen text; v_cliente_id text; v_mov text:=btrim(coalesce(p_payload->>'movimiento_id',''));
  v_res text:=btrim(coalesce(p_payload->>'reserva_id','')); v_pago text:=btrim(coalesce(p_payload->>'pago_id',''));
  v_token text:=btrim(coalesce(p_payload->>'token','')); v_expira timestamptz:=(p_payload->>'token_expira')::timestamptz;
  v_apertura time; v_cierre time; v_item jsonb; v_n int:=0;
begin
  begin v_request:=(p_payload->>'request_id')::uuid; exception when others then raise exception using errcode='22023',message='REQUEST_ID_INVALIDO'; end;
  v_fingerprint:=encode(extensions.digest((p_payload-'request_id'-'cliente_id'-'movimiento_id'-'reserva_id'-'pago_id'-'token')::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_request::text,28001));
  select * into v_existing from public.gift_card_reservas where request_id=v_request for update;
  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint then raise exception using errcode='23505',message='REQUEST_ID_PAYLOAD_CONFLICTO'; end if;
    return jsonb_build_object('ok',true,'reutilizado',true,'reserva_id',v_existing.reserva_id,'movimiento_id',v_existing.movimiento_id,'token',(select token_ficha from public.citas_reservadas where reserva_id=v_existing.reserva_id),'monto_reservado_gift_card',v_existing.monto_reservado);
  end if;
  select * into v_gift from public.gift_cards where giftcard_id=btrim(coalesce(p_payload->>'giftcard_id','')) for update;
  if not found then raise exception using errcode='P0002',message='GIFT_CARD_NO_EXISTE'; end if;
  if v_gift.estado='ANULADA' then raise exception using errcode='22023',message='GIFT_CARD_ANULADA'; end if;
  if v_gift.estado='USADA' then raise exception using errcode='22023',message='GIFT_CARD_USADA'; end if;
  if v_gift.fecha_vencimiento<(now() at time zone 'America/Lima')::date then raise exception using errcode='22023',message='GIFT_CARD_VENCIDA'; end if;
  if v_gift.tipo='SERVICIO' and exists(select 1 from public.gift_card_reservas where giftcard_id=v_gift.giftcard_id and estado='ACTIVA') then raise exception using errcode='22023',message='GIFT_CARD_YA_RESERVADA'; end if;
  select coalesce(sum(monto_usado),0) into v_usado from public.gift_card_usos where giftcard_id=v_gift.giftcard_id;
  select coalesce(sum(monto_reservado),0) into v_comprometido from public.gift_card_reservas where giftcard_id=v_gift.giftcard_id and estado='ACTIVA';
  v_disponible:=greatest(v_gift.monto-v_usado-v_comprometido,0);
  if v_disponible<=0 then raise exception using errcode='22023',message='SALDO_INSUFICIENTE'; end if;
  if v_fecha<(now() at time zone 'America/Lima')::date or v_sede='' or v_cliente='' or v_responsable='' or v_whatsapp!~'^\+[1-9][0-9]{7,14}$' or v_pais!~'^[A-Z]{2}$' then raise exception using errcode='22023',message='DATOS_PREPARACION_INVALIDOS'; end if;
  if lower(btrim(coalesce(p_payload->>'canal',''))) <> 'directo' or lower(btrim(coalesce(p_payload->>'tipo_atencion',''))) <> 'sede' or coalesce((p_payload->>'atencion_personalizada')::boolean,false) or btrim(coalesce(p_payload->>'cupon_promocional',''))<>'' then raise exception using errcode='22023',message='GIFT_CARD_SOLO_CITA_NORMAL_SEDE'; end if;
  if v_gift.tipo='SERVICIO' then
    select * into v_catalog from public.caja_catalog_services where release_id=v_gift.catalog_release_id and service_code=v_gift.service_code and price_version=v_gift.catalog_price_version;
    if not found or v_catalog.name_es is distinct from v_gift.service_name_snapshot or v_catalog.duration_min is distinct from v_gift.service_duration_min or v_catalog.price_pen is distinct from v_gift.service_price_pen then raise exception using errcode='22023',message='SERVICIO_HISTORICO_NO_COINCIDE'; end if;
    if v_catalog.category='HOME' or v_catalog.modality='HOME' or v_catalog.reservation_behavior<>'APPOINTMENT' or v_catalog.selection_rule not in ('ONE_PERSON','FIXED_TWO_PACKAGE') then raise exception using errcode='22023',message='SERVICIO_GIFT_CARD_FUERA_DE_ALCANCE'; end if;
    v_personas:=case when v_catalog.selection_rule='FIXED_TWO_PACKAGE' then 2 else 1 end;
    v_total:=v_gift.service_price_pen; v_subtotal:=v_total; v_duracion:=v_gift.service_duration_min; v_resumen:=v_gift.service_name_snapshot;
    v_servicios:=jsonb_build_array(jsonb_build_object('codigo',v_gift.service_code,'nombre',v_gift.service_name_snapshot,'duracion_min',v_duracion,'precio',v_total,'release_id',v_gift.catalog_release_id,'price_version',v_gift.catalog_price_version));
    v_cobertura:=v_disponible;
  elsif v_gift.tipo='MONTO' then
    if v_personas not in (1,2) or jsonb_typeof(coalesce(p_payload->'servicios','[]'::jsonb))<>'array' then raise exception using errcode='22023',message='SELECCION_SERVICIOS_INVALIDA'; end if;
    select jsonb_agg(to_jsonb(btrim(x.value->>'codigo')) order by x.ord) into v_codigos from jsonb_array_elements(p_payload->'servicios') with ordinality x(value,ord);
    v_resuelto:=public.caja_catalog_resolve_appointment_v1(v_codigos,v_personas,null);
    v_servicios:=v_resuelto->'services';
    if exists(select 1 from jsonb_array_elements(v_servicios) s where s->>'category'='HOME' or s->>'modality'='HOME') then raise exception using errcode='22023',message='GIFT_CARD_SOLO_CITA_NORMAL_SEDE'; end if;
    v_total:=(v_resuelto->>'total')::numeric; v_subtotal:=(v_resuelto->>'subtotal')::numeric;
    select max((x->>'duracion_min')::int),string_agg(x->>'nombre',' + ') into v_duracion,v_resumen from jsonb_array_elements(v_servicios) x;
    v_cobertura:=least(v_disponible,v_total);
  else raise exception using errcode='22023',message='TIPO_GIFT_CARD_INVALIDO'; end if;
  select hora_apertura,hora_cierre into v_apertura,v_cierre from public.sedes where nombre=v_sede and activo is true;
  if not found or v_hora<v_apertura or v_hora+make_interval(mins=>v_duracion)>v_cierre then raise exception using errcode='22023',message='HORARIO_FUERA_DE_SEDE'; end if;
  v_adelanto:=case when v_personas=2 then round(v_total*.5,2) else least(10,v_total) end;
  v_efectivo_min:=greatest(v_adelanto-v_cobertura,0);
  if v_pagado<0 or v_pagado>v_total-v_cobertura then raise exception using errcode='22023',message='MONTO_PAGADO_INVALIDO'; end if;
  if v_pagado<v_efectivo_min then raise exception using errcode='22023',message='PAGO_INSUFICIENTE'; end if;
  if v_pagado>0 and (v_metodo='' or not exists(select 1 from public.config_listas where lista='METODOS_PAGO' and activo is true and upper(btrim(valor))=v_metodo)) then raise exception using errcode='22023',message='METODO_PAGO_NO_PERMITIDO'; end if;
  if v_pagado>0 and v_metodo<>'EFECTIVO' and v_operacion='' then raise exception using errcode='22023',message='NUMERO_OPERACION_REQUERIDO'; end if;
  if v_mov='' or v_res='' or (v_pagado>0 and v_pago='') or v_token!~'^[A-Za-z0-9_-]{43}$' or v_expira<((v_fecha+v_hora)+make_interval(mins=>v_duracion)) at time zone 'America/Lima' then raise exception using errcode='22023',message='IDENTIFICADORES_O_TOKEN_INVALIDOS'; end if;
  select cliente_id into v_cliente_id from public.clientes where whatsapp_e164=v_whatsapp limit 1;
  if v_cliente_id is null then v_cliente_id:=btrim(coalesce(p_payload->>'cliente_id','')); insert into public.clientes(cliente_id,cliente,whatsapp,whatsapp_e164,pais_telefono,ultima_sede,ultimo_servicio,origen,updated_at) values(v_cliente_id,v_cliente,v_whatsapp,v_whatsapp,v_pais,v_sede,v_resumen,'APP_CAJA_FICHA',now());
  else update public.clientes set cliente=v_cliente,whatsapp=v_whatsapp,pais_telefono=v_pais,ultima_sede=v_sede,ultimo_servicio=v_resumen,updated_at=now() where cliente_id=v_cliente_id; end if;
  insert into public.caja_movimientos(movimiento_id,fecha,hora,sede,tipo_movimiento,estado,cliente_id,cliente,whatsapp,n_pax,servicio,duracion,monto_servicio,total_extras,total_cobrar,total_pagado,pendiente,responsable,source_type,source_id,observacion,estado_boleta)
  values(v_mov,v_fecha,v_hora,v_sede,'RESERVA_APP','Reservado',v_cliente_id,v_cliente,v_whatsapp,v_personas,v_resumen,v_duracion||' min',v_subtotal,0,v_total,v_pagado,greatest(v_total-v_pagado-v_cobertura,0),v_responsable,'APP_CAJA_GIFT_CARD',v_res,nullif(btrim(p_payload->>'observacion'),''),'No aplica');
  insert into public.citas_reservadas(reserva_id,fecha_cita,hora_cita,sede,cliente_id,cliente,whatsapp,n_pax,personas,servicio,duracion,duracion_min,monto_total,adelanto,metodo_adelanto,saldo_pendiente,estado,source,source_id,estado_ficha,canal,requiere_confirmacion,idioma,token_ficha,token_expira,es_gift_card,servicios_json,observacion,tipo_atencion,sede_operativa,request_id,request_fingerprint)
  values(v_res,v_fecha,v_hora,v_sede,v_cliente_id,v_cliente,v_whatsapp,v_personas,v_personas,v_resumen,v_duracion||' min',v_duracion,v_total,v_pagado,case when v_pagado>0 then v_metodo end,greatest(v_total-v_pagado-v_cobertura,0),'PENDIENTE','APP_CAJA_GIFT_CARD',v_mov,'pendiente','directo',false,coalesce(nullif(btrim(p_payload->>'idioma'),''),'es'),v_token,v_expira,true,v_servicios,nullif(btrim(p_payload->>'observacion'),''),'sede',v_sede,v_request,v_fingerprint);
  if v_pagado>0 then insert into public.caja_pagos(pago_id,movimiento_id,fecha,hora,sede,tipo_pago,metodo,monto,concepto,numero_operacion) values(v_pago,v_mov,(now() at time zone 'America/Lima')::date,(now() at time zone 'America/Lima')::time,v_sede,'ADELANTO_APP',v_metodo,v_pagado,v_resumen,nullif(v_operacion,'')); end if;
  for v_n in 1..v_personas loop
    v_item:=case when jsonb_array_length(v_servicios)=1 then v_servicios->0 else v_servicios->(v_n-1) end;
    insert into public.caja_atencion_detalle(detalle_id,movimiento_id,fecha,sede,persona_n,terapista,servicio,duracion,monto_asignado,observacion) values(v_res||'-P'||v_n,v_mov,v_fecha,v_sede,v_n,'Por asignar',v_item->>'nombre',(v_item->>'duracion_min')||' min',case when jsonb_array_length(v_servicios)=1 and v_personas=2 then round(v_total/2,2) else (v_item->>'precio')::numeric end,nullif(btrim(p_payload->>'observacion'),''));
  end loop;
  insert into public.gift_card_reservas(giftcard_id,reserva_id,movimiento_id,monto_reservado,estado,responsable,request_id,request_fingerprint) values(v_gift.giftcard_id,v_res,v_mov,v_cobertura,'ACTIVA',v_responsable,v_request,v_fingerprint);
  return jsonb_build_object('ok',true,'reutilizado',false,'reserva_id',v_res,'movimiento_id',v_mov,'token',v_token,'monto_reservado_gift_card',v_cobertura,'efectivo_minimo_adicional',v_efectivo_min);
end $$;

create or replace function public.liberar_reserva_gift_card_v1(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_request uuid; v_fp text; v_hold public.gift_card_reservas%rowtype; v_responsable text:=btrim(coalesce(p_payload->>'responsable',''));
begin
  begin v_request:=(p_payload->>'request_id')::uuid; exception when others then raise exception using errcode='22023',message='REQUEST_ID_INVALIDO'; end;
  v_fp:=encode(extensions.digest((p_payload-'request_id')::text,'sha256'),'hex');
  select * into v_hold from public.gift_card_reservas where giftcard_id=btrim(coalesce(p_payload->>'giftcard_id','')) and reserva_id=btrim(coalesce(p_payload->>'reserva_id','')) for update;
  if not found then raise exception using errcode='P0002',message='HOLD_NO_EXISTE'; end if;
  perform 1 from public.gift_cards where giftcard_id=v_hold.giftcard_id for update;
  if v_hold.estado='LIBERADA' and v_hold.release_request_id=v_request and v_hold.release_request_fingerprint=v_fp then return jsonb_build_object('ok',true,'reutilizado',true,'reserva_id',v_hold.reserva_id); end if;
  if v_hold.estado<>'ACTIVA' then raise exception using errcode='22023',message='HOLD_NO_ACTIVO'; end if;
  if v_responsable='' then raise exception using errcode='22023',message='RESPONSABLE_REQUERIDO'; end if;
  update public.gift_card_reservas set estado='LIBERADA',released_at=clock_timestamp(),released_by=v_responsable,release_request_id=v_request,release_request_fingerprint=v_fp where id=v_hold.id;
  return jsonb_build_object('ok',true,'reutilizado',false,'reserva_id',v_hold.reserva_id,'monto_liberado',v_hold.monto_reservado);
end $$;

-- El canje manual sólo puede consumir saldo financiero no comprometido.
create or replace function public.canjear_gift_card_v1(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_request uuid; v_fp text; v_replay public.gift_card_usos%rowtype; v_gift public.gift_cards%rowtype; v_monto numeric(12,2); v_usado numeric(12,2); v_hold numeric(12,2); v_saldo numeric(12,2); v_nuevo text; v_resp text:=btrim(coalesce(p_payload->>'responsable','')); v_now timestamp:=(now() at time zone 'America/Lima');
begin
  begin v_request:=(p_payload->>'request_id')::uuid; exception when others then raise exception using errcode='22023',message='REQUEST_ID_INVALIDO'; end;
  v_fp:=encode(extensions.digest((p_payload-'request_id')::text,'sha256'),'hex'); perform pg_advisory_xact_lock(hashtextextended(v_request::text,23002));
  select * into v_replay from public.gift_card_usos where request_id=v_request; if found then if v_replay.request_fingerprint<>v_fp then raise exception using errcode='23505',message='REQUEST_ID_PAYLOAD_CONFLICTO'; end if; return jsonb_build_object('ok',true,'reutilizado',true,'uso_id',v_replay.uso_id); end if;
  select * into v_gift from public.gift_cards where codigo=upper(btrim(coalesce(p_payload->>'codigo',''))) for update; if not found then raise exception using errcode='P0002',message='GIFT_CARD_NO_EXISTE'; end if;
  if v_gift.estado='ANULADA' then raise exception using errcode='22023',message='GIFT_CARD_ANULADA'; elsif v_gift.estado='USADA' then raise exception using errcode='22023',message='GIFT_CARD_USADA'; elsif v_gift.fecha_vencimiento<v_now::date then raise exception using errcode='22023',message='GIFT_CARD_VENCIDA'; end if;
  select coalesce(sum(monto_usado),0) into v_usado from public.gift_card_usos where giftcard_id=v_gift.giftcard_id;
  select coalesce(sum(monto_reservado),0) into v_hold from public.gift_card_reservas where giftcard_id=v_gift.giftcard_id and estado='ACTIVA';
  v_saldo:=greatest(v_gift.monto-v_usado-v_hold,0); if v_gift.tipo='SERVICIO' then v_monto:=v_gift.monto; else begin v_monto:=(p_payload->>'monto_usado')::numeric; exception when others then raise exception using errcode='22023',message='MONTO_CANJE_INVALIDO'; end; end if;
  if v_resp='' or v_monto<=0 or v_monto>v_saldo then raise exception using errcode='22023',message='SALDO_RESERVADO_O_INSUFICIENTE'; end if;
  if nullif(btrim(coalesce(p_payload->>'movimiento_id','')),'') is not null and not exists(select 1 from public.caja_movimientos where movimiento_id=p_payload->>'movimiento_id') then raise exception using errcode='22023',message='MOVIMIENTO_ASOCIADO_INVALIDO'; end if;
  if nullif(btrim(coalesce(p_payload->>'reserva_id','')),'') is not null and not exists(select 1 from public.citas_reservadas where reserva_id=p_payload->>'reserva_id') then raise exception using errcode='22023',message='RESERVA_ASOCIADA_INVALIDA'; end if;
  if nullif(btrim(coalesce(p_payload->>'atencion_movimiento_id','')),'') is not null and not exists(select 1 from public.caja_movimientos where movimiento_id=p_payload->>'atencion_movimiento_id' and tipo_movimiento in ('ATENCION_APP','ATENCION_HISTORICA')) then raise exception using errcode='22023',message='ATENCION_ASOCIADA_INVALIDA'; end if;
  v_nuevo:=case when v_monto=v_gift.monto-v_usado then 'USADA' else 'PARCIALMENTE_USADA' end;
  insert into public.gift_card_usos(giftcard_id,monto_usado,service_code,fecha_uso,hora_uso,responsable,movimiento_id,reserva_id,atencion_movimiento_id,observacion,request_id,request_fingerprint) values(v_gift.giftcard_id,v_monto,v_gift.service_code,v_now::date,v_now::time,v_resp,nullif(btrim(p_payload->>'movimiento_id'),''),nullif(btrim(p_payload->>'reserva_id'),''),nullif(btrim(p_payload->>'atencion_movimiento_id'),''),nullif(btrim(p_payload->>'observacion'),''),v_request,v_fp) returning * into v_replay;
  update public.gift_cards set estado=v_nuevo,fecha_uso=case when v_nuevo='USADA' then v_now::date else fecha_uso end,updated_at=clock_timestamp() where giftcard_id=v_gift.giftcard_id;
  insert into public.gift_card_eventos(giftcard_id,evento,estado_anterior,estado_nuevo,responsable,referencia_id,metadata) values(v_gift.giftcard_id,'CANJE',v_gift.estado,v_nuevo,v_resp,v_replay.uso_id::text,jsonb_build_object('monto_usado',v_monto,'saldo_restante',v_gift.monto-v_usado-v_monto));
  return jsonb_build_object('ok',true,'reutilizado',false,'uso_id',v_replay.uso_id,'giftcard_id',v_gift.giftcard_id,'estado',v_nuevo,'saldo_restante',v_gift.monto-v_usado-v_monto);
end $$;

create table if not exists public.gift_card_atencion_requests(request_id uuid primary key,request_fingerprint text not null,respuesta jsonb not null,created_at timestamptz not null default clock_timestamp());
alter table public.gift_card_atencion_requests enable row level security;
revoke all on table public.gift_card_atencion_requests from public,anon,authenticated;
grant select,insert on table public.gift_card_atencion_requests to service_role;

create or replace function public.iniciar_o_cerrar_atencion_reservada_gift_card_v1(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_request uuid; v_fp text; v_saved public.gift_card_atencion_requests%rowtype; v_mov public.caja_movimientos%rowtype; v_res public.citas_reservadas%rowtype; v_hold public.gift_card_reservas%rowtype; v_gift public.gift_cards%rowtype; v_base jsonb; v_uso uuid; v_estado text; v_pendiente numeric(12,2); v_pago numeric(12,2); v_response jsonb; v_now timestamp:=(now() at time zone 'America/Lima');
begin
  begin v_request:=(p_payload->>'request_id')::uuid; v_pago:=coalesce((p_payload->>'pago_restante')::numeric,0); exception when others then raise exception using errcode='22023',message='REQUEST_O_PAGO_INVALIDO'; end;
  v_fp:=encode(extensions.digest((p_payload-'request_id')::text,'sha256'),'hex'); perform pg_advisory_xact_lock(hashtextextended(v_request::text,28002));
  select * into v_saved from public.gift_card_atencion_requests where request_id=v_request for update; if found then if v_saved.request_fingerprint<>v_fp then raise exception using errcode='23505',message='REQUEST_ID_PAYLOAD_CONFLICTO'; end if; return v_saved.respuesta||jsonb_build_object('reutilizado',true); end if;
  select * into v_mov from public.caja_movimientos where movimiento_id=btrim(p_payload->>'movimiento_id') for update;
  select * into v_res from public.citas_reservadas where reserva_id=btrim(p_payload->>'reserva_id') for update;
  select * into v_hold from public.gift_card_reservas where reserva_id=v_res.reserva_id and estado in ('ACTIVA','CANJEADA') for update;
  if not found then return public.iniciar_o_cerrar_atencion_reservada_v1(p_payload); end if;
  select * into v_gift from public.gift_cards where giftcard_id=v_hold.giftcard_id for update;
  if v_mov.source_id is distinct from v_res.reserva_id or v_hold.movimiento_id is distinct from v_mov.movimiento_id then raise exception using errcode='23514',message='HOLD_RESERVA_MOVIMIENTO_NO_RELACIONADO'; end if;
  if v_pago>coalesce(v_mov.pendiente,0) then raise exception using errcode='22023',message='PAGO_FINAL_SUPERA_PENDIENTE'; end if;
  v_base:=public.iniciar_o_cerrar_atencion_reservada_v1(p_payload);
  if v_hold.estado='ACTIVA' then
    if v_gift.estado in ('ANULADA','USADA') or v_gift.fecha_vencimiento<v_now::date then raise exception using errcode='22023',message='GIFT_CARD_NO_CANJEABLE'; end if;
    insert into public.gift_card_usos(giftcard_id,monto_usado,service_code,fecha_uso,hora_uso,responsable,movimiento_id,reserva_id,atencion_movimiento_id,observacion,request_id,request_fingerprint) values(v_gift.giftcard_id,v_hold.monto_reservado,v_gift.service_code,v_now::date,v_now::time,btrim(p_payload->>'responsable'),v_hold.movimiento_id,v_hold.reserva_id,v_hold.movimiento_id,'Canje atómico al concretar atención',extensions.gen_random_uuid(),v_fp) returning uso_id into v_uso;
    v_estado:=case when (select coalesce(sum(monto_usado),0) from public.gift_card_usos where giftcard_id=v_gift.giftcard_id)>=v_gift.monto then 'USADA' else 'PARCIALMENTE_USADA' end;
    update public.gift_cards set estado=v_estado,fecha_uso=case when v_estado='USADA' then v_now::date else fecha_uso end,updated_at=clock_timestamp() where giftcard_id=v_gift.giftcard_id;
    update public.gift_card_reservas set estado='CANJEADA',redeemed_at=clock_timestamp(),uso_id=v_uso where id=v_hold.id;
    insert into public.gift_card_eventos(giftcard_id,evento,estado_anterior,estado_nuevo,responsable,referencia_id,metadata) values(v_gift.giftcard_id,'CANJE',v_gift.estado,v_estado,btrim(p_payload->>'responsable'),v_uso::text,jsonb_build_object('monto_usado',v_hold.monto_reservado,'reserva_id',v_hold.reserva_id));
  end if;
  v_pendiente:=greatest((v_base->>'pendiente')::numeric-v_hold.monto_reservado,0);
  update public.caja_movimientos set pendiente=v_pendiente,estado=case when v_pendiente=0 then 'Atendido' else 'En atención' end where movimiento_id=v_mov.movimiento_id;
  update public.citas_reservadas set saldo_pendiente=v_pendiente,estado=case when v_pendiente=0 then 'ATENDIDA_APP' else 'EN_ATENCION' end where reserva_id=v_res.reserva_id;
  v_response:=v_base||jsonb_build_object('pendiente',v_pendiente,'completada',v_pendiente=0,'cobertura_gift_card',v_hold.monto_reservado,'hold_estado','CANJEADA');
  insert into public.gift_card_atencion_requests values(v_request,v_fp,v_response,clock_timestamp()); return v_response;
end $$;

revoke all on function public.preparar_ficha_cita_gift_card_v1(jsonb),public.liberar_reserva_gift_card_v1(jsonb),public.canjear_gift_card_v1(jsonb),public.iniciar_o_cerrar_atencion_reservada_gift_card_v1(jsonb) from public,anon,authenticated;
grant execute on function public.preparar_ficha_cita_gift_card_v1(jsonb),public.liberar_reserva_gift_card_v1(jsonb),public.canjear_gift_card_v1(jsonb),public.iniciar_o_cerrar_atencion_reservada_gift_card_v1(jsonb) to service_role;
comment on table public.gift_card_reservas is 'Hold financiero-operativo; no es ingreso ni cambia el estado principal de la Gift Card.';
comment on function public.iniciar_o_cerrar_atencion_reservada_gift_card_v1(jsonb) is 'Concilia pagos reales de caja_pagos más cobertura canjeada, sin duplicar ingresos.';
commit;

-- Gift Cards v1: emisión, ledger compartido, canje y anulación auditables.
-- Aplicación manual. Este archivo no ejecuta cambios remotos por sí solo.
begin;

alter table public.gift_cards
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists codigo text,
  add column if not exists tipo text,
  add column if not exists comprador_cliente_id text,
  add column if not exists whatsapp_beneficiario text,
  add column if not exists dedicatoria text,
  add column if not exists service_code text,
  add column if not exists service_name_snapshot text,
  add column if not exists service_duration_min integer,
  add column if not exists service_price_pen numeric(12,2),
  add column if not exists catalog_release_id text,
  add column if not exists catalog_price_version text,
  add column if not exists fecha_emision date,
  add column if not exists fecha_vencimiento date,
  add column if not exists movimiento_id text,
  add column if not exists pago_id text,
  add column if not exists request_id uuid,
  add column if not exists request_fingerprint text,
  add column if not exists emitida_por text,
  add column if not exists anulada_at timestamptz,
  add column if not exists anulada_por text,
  add column if not exists motivo_anulacion text;

update public.gift_cards
set fecha_emision = coalesce(fecha_emision, fecha_venta),
    fecha_vencimiento = coalesce(fecha_vencimiento, (fecha_venta + interval '1 year')::date),
    tipo = coalesce(tipo, case when nullif(btrim(servicio), '') is null then 'MONTO' else 'SERVICIO' end),
    service_name_snapshot = coalesce(service_name_snapshot, nullif(btrim(servicio), '')),
    service_duration_min = coalesce(service_duration_min, nullif(regexp_replace(coalesce(duracion, ''), '[^0-9]', '', 'g'), '')::integer),
    service_price_pen = coalesce(service_price_pen, monto),
    codigo = coalesce(codigo, 'GC-LEGACY-' || upper(substr(md5(giftcard_id), 1, 8))),
    estado = case upper(coalesce(estado, ''))
      when 'USADA' then 'USADA'
      when 'CANJEADA' then 'USADA'
      when 'VENCIDA' then 'VENCIDA'
      when 'ANULADA' then 'ANULADA'
      else 'EMITIDA'
    end
where fecha_emision is null or fecha_vencimiento is null or tipo is null or codigo is null
   or estado not in ('EMITIDA','PARCIALMENTE_USADA','USADA','VENCIDA','ANULADA');

create unique index if not exists gift_cards_id_unique on public.gift_cards(id);
create unique index if not exists gift_cards_codigo_unique on public.gift_cards(codigo);
create unique index if not exists gift_cards_request_id_unique on public.gift_cards(request_id) where request_id is not null;
create index if not exists gift_cards_beneficiario_idx on public.gift_cards(lower(destinatario));
create index if not exists gift_cards_beneficiario_whatsapp_idx on public.gift_cards(whatsapp_beneficiario);
create index if not exists gift_cards_emision_tipo_idx on public.gift_cards(fecha_emision desc, tipo);

alter table public.gift_cards alter column estado set default 'EMITIDA';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'gift_cards_tipo_v1_check') then
    alter table public.gift_cards add constraint gift_cards_tipo_v1_check
      check (tipo is null or tipo in ('SERVICIO','MONTO')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gift_cards_estado_v1_check') then
    alter table public.gift_cards add constraint gift_cards_estado_v1_check
      check (estado in ('EMITIDA','PARCIALMENTE_USADA','USADA','VENCIDA','ANULADA')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gift_cards_codigo_v1_check') then
    alter table public.gift_cards add constraint gift_cards_codigo_v1_check
      check (codigo is null or codigo ~ '^GC-(VITA|LEGACY)-[A-Z0-9]{8}$') not valid;
  end if;
end $$;

create table if not exists public.gift_card_usos (
  uso_id uuid primary key default gen_random_uuid(),
  giftcard_id text not null references public.gift_cards(giftcard_id) on delete restrict,
  monto_usado numeric(12,2) not null check (monto_usado > 0),
  service_code text,
  fecha_uso date not null,
  hora_uso time not null,
  responsable text not null check (btrim(responsable) <> ''),
  movimiento_id text,
  reserva_id text,
  atencion_movimiento_id text,
  observacion text,
  request_id uuid not null unique,
  request_fingerprint text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists gift_card_usos_giftcard_idx on public.gift_card_usos(giftcard_id, created_at);

create table if not exists public.gift_card_eventos (
  evento_id uuid primary key default gen_random_uuid(),
  giftcard_id text not null references public.gift_cards(giftcard_id) on delete restrict,
  evento text not null check (evento in ('EMISION','CANJE','ANULACION','VENCIMIENTO_REGISTRADO')),
  estado_anterior text,
  estado_nuevo text not null,
  responsable text not null,
  motivo text,
  referencia_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists gift_card_eventos_giftcard_idx on public.gift_card_eventos(giftcard_id, created_at);

create or replace view public.vista_gift_cards_operativa as
select g.*,
  case when g.estado not in ('ANULADA','USADA') and g.fecha_vencimiento < (now() at time zone 'America/Lima')::date
    then 'VENCIDA' else g.estado end as estado_efectivo,
  greatest(coalesce(g.monto, 0) - coalesce(u.total_usado, 0), 0)::numeric(12,2) as saldo_restante,
  coalesce(u.total_usado, 0)::numeric(12,2) as total_usado,
  coalesce(u.cantidad_usos, 0)::integer as cantidad_usos
from public.gift_cards g
left join lateral (
  select sum(monto_usado) total_usado, count(*) cantidad_usos
  from public.gift_card_usos where giftcard_id = g.giftcard_id
) u on true;

create or replace function public.emitir_gift_card_v1(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_request uuid; v_fingerprint text; v_existing public.gift_cards%rowtype;
  v_tipo text:=upper(btrim(coalesce(p_payload->>'tipo',''))); v_service_code text:=btrim(coalesce(p_payload->>'service_code',''));
  v_comprador text:=btrim(coalesce(p_payload->>'comprador','')); v_beneficiario text:=btrim(coalesce(p_payload->>'beneficiario',''));
  v_wa_comprador text:=nullif(btrim(coalesce(p_payload->>'whatsapp_comprador','')),''); v_wa_beneficiario text:=nullif(btrim(coalesce(p_payload->>'whatsapp_beneficiario','')),'');
  v_sede text:=btrim(coalesce(p_payload->>'sede','')); v_metodo text:=btrim(coalesce(p_payload->>'metodo_pago',''));
  v_operacion text:=nullif(btrim(coalesce(p_payload->>'numero_operacion','')),''); v_responsable text:=btrim(coalesce(p_payload->>'responsable',''));
  v_valor numeric(12,2); v_recibido numeric(12,2); v_fecha date:=(now() at time zone 'America/Lima')::date;
  v_hora time:=(now() at time zone 'America/Lima')::time; v_vence date; v_giftcard_id text; v_codigo text; v_mov text; v_pago text;
  v_catalog record; v_result jsonb; v_intentos int:=0;
begin
  begin v_request:=(p_payload->>'request_id')::uuid; exception when others then raise exception using errcode='22023',message='REQUEST_ID_INVALIDO'; end;
  if v_request is null then raise exception using errcode='22023',message='REQUEST_ID_REQUERIDO'; end if;
  v_fingerprint:=encode(digest((p_payload-'request_id')::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_request::text,23001));
  select * into v_existing from public.gift_cards where request_id=v_request for update;
  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint then raise exception using errcode='23505',message='REQUEST_ID_PAYLOAD_CONFLICTO'; end if;
    return jsonb_build_object('ok',true,'reutilizado',true,'giftcard_id',v_existing.giftcard_id,'codigo',v_existing.codigo,'fecha_emision',v_existing.fecha_emision,'fecha_vencimiento',v_existing.fecha_vencimiento,'movimiento_id',v_existing.movimiento_id,'pago_id',v_existing.pago_id);
  end if;
  if v_tipo not in ('SERVICIO','MONTO') then raise exception using errcode='22023',message='TIPO_GIFT_CARD_INVALIDO'; end if;
  if v_comprador='' or v_beneficiario='' or v_sede='' or v_responsable='' then raise exception using errcode='22023',message='DATOS_EMISION_INCOMPLETOS'; end if;
  if not exists(select 1 from public.sedes where nombre=v_sede and activo is true) then raise exception using errcode='22023',message='SEDE_NO_PERMITIDA'; end if;
  if v_wa_comprador is not null and v_wa_comprador !~ '^\+[1-9][0-9]{7,14}$' then raise exception using errcode='22023',message='WHATSAPP_COMPRADOR_INVALIDO'; end if;
  if v_wa_beneficiario is not null and v_wa_beneficiario !~ '^\+[1-9][0-9]{7,14}$' then raise exception using errcode='22023',message='WHATSAPP_BENEFICIARIO_INVALIDO'; end if;
  if v_tipo='SERVICIO' then
    select s.service_code,s.name_es,s.duration_min,s.price_pen,s.release_id,s.price_version into v_catalog
    from public.caja_catalog_services s join public.caja_catalog_releases r using(release_id)
    where r.active and s.active and s.service_code=v_service_code;
    if not found then raise exception using errcode='22023',message='SERVICIO_CANONICO_NO_DISPONIBLE'; end if;
    v_valor:=v_catalog.price_pen;
  else
    begin v_valor:=(p_payload->>'monto')::numeric; exception when others then raise exception using errcode='22023',message='MONTO_INVALIDO'; end;
    if v_valor<=0 or v_valor<>round(v_valor,2) then raise exception using errcode='22023',message='MONTO_INVALIDO'; end if;
  end if;
  begin v_recibido:=(p_payload->>'monto_recibido')::numeric; exception when others then raise exception using errcode='22023',message='MONTO_RECIBIDO_INVALIDO'; end;
  if v_recibido<>v_valor then raise exception using errcode='22023',message='GIFT_CARD_REQUIERE_PAGO_TOTAL'; end if;
  if not exists(select 1 from public.config_listas where lista='METODOS_PAGO' and activo is true and upper(btrim(valor))=upper(v_metodo)) then raise exception using errcode='22023',message='METODO_PAGO_NO_PERMITIDO'; end if;
  if upper(v_metodo)<>'EFECTIVO' and v_operacion is null then raise exception using errcode='22023',message='NUMERO_OPERACION_REQUERIDO'; end if;
  v_vence:=(v_fecha + interval '1 year')::date;
  v_giftcard_id:='GC-APP-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
  loop
    v_intentos:=v_intentos+1; v_codigo:='GC-VITA-'||upper(substr(encode(gen_random_bytes(8),'hex'),1,8));
    exit when not exists(select 1 from public.gift_cards where codigo=v_codigo);
    if v_intentos>=10 then raise exception 'NO_SE_PUDO_GENERAR_CODIGO'; end if;
  end loop;
  v_mov:='MOV-GC-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
  v_pago:='PAG-GC-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
  insert into public.caja_movimientos(movimiento_id,fecha,hora,sede,tipo_movimiento,estado,cliente_id,cliente,whatsapp,n_pax,servicio,duracion,monto_servicio,total_cobrar,total_pagado,pendiente,responsable,source_type,source_id,observacion)
  values(v_mov,v_fecha,v_hora,v_sede,'GIFT_CARD_VENTA','Registrado',nullif(p_payload->>'comprador_cliente_id',''),v_comprador,v_wa_comprador,1,
    case when v_tipo='SERVICIO' then 'Gift Card · '||v_catalog.name_es else 'Gift Card por monto' end,
    case when v_tipo='SERVICIO' then v_catalog.duration_min||' min' else null end,v_valor,v_valor,v_recibido,0,v_responsable,'GIFT_CARD',v_giftcard_id,nullif(btrim(coalesce(p_payload->>'dedicatoria','')),''));
  insert into public.caja_pagos(pago_id,movimiento_id,fecha,hora,sede,tipo_pago,metodo,metodo_detalle,monto,concepto,numero_operacion)
  values(v_pago,v_mov,v_fecha,v_hora,v_sede,'GIFT_CARD_VENTA',v_metodo,null,v_recibido,'Venta de Gift Card',v_operacion);
  insert into public.gift_cards(giftcard_id,codigo,tipo,fecha_venta,fecha_emision,fecha_vencimiento,comprador,comprador_cliente_id,whatsapp_comprador,destinatario,whatsapp_beneficiario,dedicatoria,n_pax,servicio,duracion,monto,metodo_pago,estado,anotado_en_caja,observacion,service_code,service_name_snapshot,service_duration_min,service_price_pen,catalog_release_id,catalog_price_version,movimiento_id,pago_id,request_id,request_fingerprint,emitida_por)
  values(v_giftcard_id,v_codigo,v_tipo,v_fecha,v_fecha,v_vence,v_comprador,nullif(p_payload->>'comprador_cliente_id',''),v_wa_comprador,v_beneficiario,v_wa_beneficiario,nullif(btrim(coalesce(p_payload->>'dedicatoria','')),''),1,
    case when v_tipo='SERVICIO' then v_catalog.name_es else null end,case when v_tipo='SERVICIO' then v_catalog.duration_min||' min' else null end,v_valor,v_metodo,'EMITIDA','SI',null,
    case when v_tipo='SERVICIO' then v_catalog.service_code else null end,case when v_tipo='SERVICIO' then v_catalog.name_es else null end,case when v_tipo='SERVICIO' then v_catalog.duration_min else null end,case when v_tipo='SERVICIO' then v_catalog.price_pen else null end,case when v_tipo='SERVICIO' then v_catalog.release_id else null end,case when v_tipo='SERVICIO' then v_catalog.price_version else null end,v_mov,v_pago,v_request,v_fingerprint,v_responsable);
  insert into public.gift_card_eventos(giftcard_id,evento,estado_nuevo,responsable,referencia_id,metadata)
  values(v_giftcard_id,'EMISION','EMITIDA',v_responsable,v_mov,jsonb_build_object('codigo',v_codigo,'tipo',v_tipo,'valor',v_valor,'pago_id',v_pago));
  return jsonb_build_object('ok',true,'reutilizado',false,'giftcard_id',v_giftcard_id,'codigo',v_codigo,'fecha_emision',v_fecha,'fecha_vencimiento',v_vence,'movimiento_id',v_mov,'pago_id',v_pago);
end $$;

create or replace function public.canjear_gift_card_v1(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_request uuid; v_fingerprint text; v_replay public.gift_card_usos%rowtype; v_gift public.gift_cards%rowtype;
  v_monto numeric(12,2); v_usado numeric(12,2); v_saldo numeric(12,2); v_nuevo text;
  v_responsable text:=btrim(coalesce(p_payload->>'responsable','')); v_ahora timestamp:=(now() at time zone 'America/Lima');
begin
  begin v_request:=(p_payload->>'request_id')::uuid; exception when others then raise exception using errcode='22023',message='REQUEST_ID_INVALIDO'; end;
  if v_request is null then raise exception using errcode='22023',message='REQUEST_ID_REQUERIDO'; end if;
  v_fingerprint:=encode(digest((p_payload-'request_id')::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_request::text,23002));
  select * into v_replay from public.gift_card_usos where request_id=v_request;
  if found then if v_replay.request_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='REQUEST_ID_PAYLOAD_CONFLICTO'; end if; return jsonb_build_object('ok',true,'reutilizado',true,'uso_id',v_replay.uso_id,'giftcard_id',v_replay.giftcard_id); end if;
  select * into v_gift from public.gift_cards where codigo=upper(btrim(coalesce(p_payload->>'codigo',''))) for update;
  if not found then raise exception using errcode='P0002',message='GIFT_CARD_NO_EXISTE'; end if;
  if v_gift.estado='ANULADA' then raise exception using errcode='22023',message='GIFT_CARD_ANULADA'; end if;
  if v_gift.estado='USADA' then raise exception using errcode='22023',message='GIFT_CARD_USADA'; end if;
  if v_gift.fecha_vencimiento<v_ahora::date then raise exception using errcode='22023',message='GIFT_CARD_VENCIDA'; end if;
  if v_responsable='' then raise exception using errcode='22023',message='RESPONSABLE_REQUERIDO'; end if;
  if nullif(btrim(coalesce(p_payload->>'movimiento_id','')),'') is not null and not exists(select 1 from public.caja_movimientos where movimiento_id=p_payload->>'movimiento_id') then raise exception using errcode='22023',message='MOVIMIENTO_ASOCIADO_INVALIDO'; end if;
  if nullif(btrim(coalesce(p_payload->>'reserva_id','')),'') is not null and not exists(select 1 from public.citas_reservadas where reserva_id=p_payload->>'reserva_id') then raise exception using errcode='22023',message='RESERVA_ASOCIADA_INVALIDA'; end if;
  if nullif(btrim(coalesce(p_payload->>'atencion_movimiento_id','')),'') is not null and not exists(select 1 from public.caja_movimientos where movimiento_id=p_payload->>'atencion_movimiento_id' and tipo_movimiento in ('ATENCION_APP','ATENCION_HISTORICA')) then raise exception using errcode='22023',message='ATENCION_ASOCIADA_INVALIDA'; end if;
  select coalesce(sum(monto_usado),0) into v_usado from public.gift_card_usos where giftcard_id=v_gift.giftcard_id;
  v_saldo:=greatest(v_gift.monto-v_usado,0);
  if v_gift.tipo='SERVICIO' then v_monto:=v_gift.monto; else begin v_monto:=(p_payload->>'monto_usado')::numeric; exception when others then raise exception using errcode='22023',message='MONTO_CANJE_INVALIDO'; end; end if;
  if v_monto<=0 or v_monto<>round(v_monto,2) or v_monto>v_saldo then raise exception using errcode='22023',message='SALDO_INSUFICIENTE'; end if;
  v_nuevo:=case when v_monto=v_saldo then 'USADA' else 'PARCIALMENTE_USADA' end;
  insert into public.gift_card_usos(giftcard_id,monto_usado,service_code,fecha_uso,hora_uso,responsable,movimiento_id,reserva_id,atencion_movimiento_id,observacion,request_id,request_fingerprint)
  values(v_gift.giftcard_id,v_monto,v_gift.service_code,v_ahora::date,v_ahora::time,v_responsable,nullif(btrim(coalesce(p_payload->>'movimiento_id','')),''),nullif(btrim(coalesce(p_payload->>'reserva_id','')),''),nullif(btrim(coalesce(p_payload->>'atencion_movimiento_id','')),''),nullif(btrim(coalesce(p_payload->>'observacion','')),''),v_request,v_fingerprint)
  returning * into v_replay;
  update public.gift_cards set estado=v_nuevo,fecha_uso=case when v_nuevo='USADA' then v_ahora::date else fecha_uso end,updated_at=clock_timestamp() where giftcard_id=v_gift.giftcard_id;
  insert into public.gift_card_eventos(giftcard_id,evento,estado_anterior,estado_nuevo,responsable,referencia_id,metadata)
  values(v_gift.giftcard_id,'CANJE',v_gift.estado,v_nuevo,v_responsable,v_replay.uso_id::text,jsonb_build_object('monto_usado',v_monto,'saldo_restante',v_saldo-v_monto));
  return jsonb_build_object('ok',true,'reutilizado',false,'uso_id',v_replay.uso_id,'giftcard_id',v_gift.giftcard_id,'estado',v_nuevo,'saldo_restante',v_saldo-v_monto);
end $$;

create or replace function public.anular_gift_card_v1(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_gift public.gift_cards%rowtype; v_motivo text:=btrim(coalesce(p_payload->>'motivo','')); v_responsable text:=btrim(coalesce(p_payload->>'responsable',''));
begin
  select * into v_gift from public.gift_cards where codigo=upper(btrim(coalesce(p_payload->>'codigo',''))) for update;
  if not found then raise exception using errcode='P0002',message='GIFT_CARD_NO_EXISTE'; end if;
  if v_motivo='' or v_responsable='' then raise exception using errcode='22023',message='ANULACION_REQUIERE_MOTIVO_Y_RESPONSABLE'; end if;
  if v_gift.estado='ANULADA' then return jsonb_build_object('ok',true,'reutilizado',true,'giftcard_id',v_gift.giftcard_id); end if;
  if v_gift.estado='USADA' then raise exception using errcode='22023',message='GIFT_CARD_USADA_NO_ANULABLE'; end if;
  update public.gift_cards set estado='ANULADA',anulada_at=clock_timestamp(),anulada_por=v_responsable,motivo_anulacion=v_motivo,updated_at=clock_timestamp() where giftcard_id=v_gift.giftcard_id;
  insert into public.gift_card_eventos(giftcard_id,evento,estado_anterior,estado_nuevo,responsable,motivo)
  values(v_gift.giftcard_id,'ANULACION',v_gift.estado,'ANULADA',v_responsable,v_motivo);
  return jsonb_build_object('ok',true,'reutilizado',false,'giftcard_id',v_gift.giftcard_id,'estado','ANULADA','reembolso_automatico',false);
end $$;

alter table public.gift_cards enable row level security;
alter table public.gift_card_usos enable row level security;
alter table public.gift_card_eventos enable row level security;
revoke all on table public.gift_cards,public.gift_card_usos,public.gift_card_eventos from public,anon,authenticated;
grant select,insert,update on table public.gift_cards,public.gift_card_usos,public.gift_card_eventos to service_role;
revoke all on table public.vista_gift_cards_operativa from public,anon,authenticated;
grant select on table public.vista_gift_cards_operativa to service_role;
revoke all on function public.emitir_gift_card_v1(jsonb),public.canjear_gift_card_v1(jsonb),public.anular_gift_card_v1(jsonb) from public,anon,authenticated;
grant execute on function public.emitir_gift_card_v1(jsonb),public.canjear_gift_card_v1(jsonb),public.anular_gift_card_v1(jsonb) to service_role;

comment on table public.gift_card_usos is 'Historial inmutable de consumos; el saldo se reconstruye como monto emitido menos usos.';
comment on column public.gift_cards.movimiento_id is 'Movimiento GIFT_CARD_VENTA que clasifica la venta; el canje no crea un segundo ingreso.';
comment on function public.anular_gift_card_v1(jsonb) is 'Anulación administrativa auditable. No genera devolución financiera automática.';

commit;

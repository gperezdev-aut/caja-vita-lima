-- Patch Gift Cards v1: evita RECORD de catálogo sin asignar en emisiones por monto.
-- Aplicar después de 024 cuando 023 y 024 ya fueron ejecutadas.
-- Idempotente: reemplaza únicamente la RPC de emisión.
begin;

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
  v_catalog_service_code public.caja_catalog_services.service_code%type;
  v_catalog_name public.caja_catalog_services.name_es%type;
  v_catalog_duration_min public.caja_catalog_services.duration_min%type;
  v_catalog_price public.caja_catalog_services.price_pen%type;
  v_catalog_release_id public.caja_catalog_services.release_id%type;
  v_catalog_price_version public.caja_catalog_services.price_version%type;
  v_result jsonb; v_intentos int:=0;
begin
  begin v_request:=(p_payload->>'request_id')::uuid; exception when others then raise exception using errcode='22023',message='REQUEST_ID_INVALIDO'; end;
  if v_request is null then raise exception using errcode='22023',message='REQUEST_ID_REQUERIDO'; end if;
  v_fingerprint:=encode(extensions.digest((p_payload-'request_id')::text,'sha256'),'hex');
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
    select s.service_code,s.name_es,s.duration_min,s.price_pen,s.release_id,s.price_version
    into v_catalog_service_code,v_catalog_name,v_catalog_duration_min,v_catalog_price,v_catalog_release_id,v_catalog_price_version
    from public.caja_catalog_services s join public.caja_catalog_releases r using(release_id)
    where r.active and s.active and s.service_code=v_service_code;
    if not found then raise exception using errcode='22023',message='SERVICIO_CANONICO_NO_DISPONIBLE'; end if;
    v_valor:=v_catalog_price;
  else
    begin v_valor:=(p_payload->>'monto')::numeric; exception when others then raise exception using errcode='22023',message='MONTO_INVALIDO'; end;
    if v_valor<=0 or v_valor<>round(v_valor,2) then raise exception using errcode='22023',message='MONTO_INVALIDO'; end if;
  end if;
  begin v_recibido:=(p_payload->>'monto_recibido')::numeric; exception when others then raise exception using errcode='22023',message='MONTO_RECIBIDO_INVALIDO'; end;
  if v_recibido<>v_valor then raise exception using errcode='22023',message='GIFT_CARD_REQUIERE_PAGO_TOTAL'; end if;
  if not exists(select 1 from public.config_listas where lista='METODOS_PAGO' and activo is true and upper(btrim(valor))=upper(v_metodo)) then raise exception using errcode='22023',message='METODO_PAGO_NO_PERMITIDO'; end if;
  if upper(v_metodo)<>'EFECTIVO' and v_operacion is null then raise exception using errcode='22023',message='NUMERO_OPERACION_REQUERIDO'; end if;
  v_vence:=(v_fecha + interval '1 year')::date;
  v_giftcard_id:='GC-APP-'||upper(substr(replace(extensions.gen_random_uuid()::text,'-',''),1,12));
  loop
    v_intentos:=v_intentos+1; v_codigo:='GC-VITA-'||upper(substr(encode(extensions.gen_random_bytes(8),'hex'),1,8));
    exit when not exists(select 1 from public.gift_cards where codigo=v_codigo);
    if v_intentos>=10 then raise exception 'NO_SE_PUDO_GENERAR_CODIGO'; end if;
  end loop;
  v_mov:='MOV-GC-'||upper(substr(replace(extensions.gen_random_uuid()::text,'-',''),1,12));
  v_pago:='PAG-GC-'||upper(substr(replace(extensions.gen_random_uuid()::text,'-',''),1,12));
  insert into public.caja_movimientos(movimiento_id,fecha,hora,sede,tipo_movimiento,estado,cliente_id,cliente,whatsapp,n_pax,servicio,duracion,monto_servicio,total_cobrar,total_pagado,pendiente,responsable,source_type,source_id,observacion)
  values(v_mov,v_fecha,v_hora,v_sede,'GIFT_CARD_VENTA','Registrado',nullif(p_payload->>'comprador_cliente_id',''),v_comprador,v_wa_comprador,1,
    case when v_tipo='SERVICIO' then 'Gift Card · '||v_catalog_name else 'Gift Card por monto' end,
    case when v_tipo='SERVICIO' then v_catalog_duration_min||' min' else null end,v_valor,v_valor,v_recibido,0,v_responsable,'GIFT_CARD',v_giftcard_id,nullif(btrim(coalesce(p_payload->>'dedicatoria','')),''));
  insert into public.caja_pagos(pago_id,movimiento_id,fecha,hora,sede,tipo_pago,metodo,metodo_detalle,monto,concepto,numero_operacion)
  values(v_pago,v_mov,v_fecha,v_hora,v_sede,'GIFT_CARD_VENTA',v_metodo,null,v_recibido,'Venta de Gift Card',v_operacion);
  insert into public.gift_cards(giftcard_id,codigo,tipo,fecha_venta,fecha_emision,fecha_vencimiento,comprador,comprador_cliente_id,whatsapp_comprador,destinatario,whatsapp_beneficiario,dedicatoria,n_pax,servicio,duracion,monto,metodo_pago,estado,anotado_en_caja,observacion,service_code,service_name_snapshot,service_duration_min,service_price_pen,catalog_release_id,catalog_price_version,movimiento_id,pago_id,request_id,request_fingerprint,emitida_por)
  values(v_giftcard_id,v_codigo,v_tipo,v_fecha,v_fecha,v_vence,v_comprador,nullif(p_payload->>'comprador_cliente_id',''),v_wa_comprador,v_beneficiario,v_wa_beneficiario,nullif(btrim(coalesce(p_payload->>'dedicatoria','')),''),1,
    case when v_tipo='SERVICIO' then v_catalog_name else null end,case when v_tipo='SERVICIO' then v_catalog_duration_min||' min' else null end,v_valor,v_metodo,'EMITIDA','SI',null,
    v_catalog_service_code,v_catalog_name,v_catalog_duration_min,v_catalog_price,v_catalog_release_id,v_catalog_price_version,v_mov,v_pago,v_request,v_fingerprint,v_responsable);
  insert into public.gift_card_eventos(giftcard_id,evento,estado_nuevo,responsable,referencia_id,metadata)
  values(v_giftcard_id,'EMISION','EMITIDA',v_responsable,v_mov,jsonb_build_object('codigo',v_codigo,'tipo',v_tipo,'valor',v_valor,'pago_id',v_pago));
  return jsonb_build_object('ok',true,'reutilizado',false,'giftcard_id',v_giftcard_id,'codigo',v_codigo,'fecha_emision',v_fecha,'fecha_vencimiento',v_vence,'movimiento_id',v_mov,'pago_id',v_pago);
end $$;

revoke all on function public.emitir_gift_card_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.emitir_gift_card_v1(jsonb)
  to service_role;

comment on function public.emitir_gift_card_v1(jsonb) is
  'Emisión atómica Gift Cards v1 con catálogo escalar opcional y pgcrypto calificado.';

commit;

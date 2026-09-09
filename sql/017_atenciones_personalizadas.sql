-- Caja Vita Lima — v17. Ejecutar manualmente después de 016; nunca desde la app.
alter table public.citas_reservadas
  add column if not exists atencion_personalizada boolean not null default false,
  add column if not exists modalidad_ejecucion text,
  add column if not exists componentes_por_persona jsonb,
  add column if not exists precio_calculado numeric(12,2),
  add column if not exists precio_final_acordado numeric(12,2),
  add column if not exists diferencia_precio numeric(12,2),
  add column if not exists motivo_ajuste text,
  add column if not exists responsable_ajuste text,
  add column if not exists fecha_ajuste timestamptz,
  add column if not exists disponibilidad_confirmada boolean not null default false;

do $$ begin
 if not exists (select 1 from pg_constraint where conname='chk_citas_personalizadas_modalidad') then
  alter table public.citas_reservadas add constraint chk_citas_personalizadas_modalidad check
   (not atencion_personalizada or (modalidad_ejecucion in ('simultanea','consecutiva') and componentes_por_persona is not null and disponibilidad_confirmada));
 end if;
end $$;

-- RPC aislada: no altera preparar_ficha_cita ni el flujo estándar de 013–016.
create or replace function public.preparar_atencion_personalizada(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_request uuid := (p_payload->>'request_id')::uuid; v_existente public.citas_reservadas%rowtype;
 v_personas int := coalesce((p_payload->>'personas')::int,0); v_componentes jsonb:=coalesce(p_payload->'componentes_por_persona','[]'::jsonb);
 v_modalidad text:=lower(btrim(coalesce(p_payload->>'modalidad_ejecucion',''))); v_calculado numeric:=0; v_final numeric:=coalesce((p_payload->>'precio_final_acordado')::numeric,0);
 v_duracion int; v_sede text:=btrim(coalesce(p_payload->>'sede','')); v_fecha date:=(p_payload->>'fecha')::date; v_hora time:=(p_payload->>'hora')::time;
 v_cliente text:=btrim(coalesce(p_payload->>'cliente','')); v_whatsapp text:=btrim(coalesce(p_payload->>'whatsapp_e164','')); v_cliente_id text;
 v_mov text:=btrim(coalesce(p_payload->>'movimiento_id','')); v_res text:=btrim(coalesce(p_payload->>'reserva_id','')); v_pago text:=btrim(coalesce(p_payload->>'pago_id','')); v_token text:=btrim(coalesce(p_payload->>'token','')); v_expira timestamptz:=(p_payload->>'token_expira')::timestamptz;
 v_adelanto numeric; v_apertura time; v_cierre time; v_fingerprint text:=md5((p_payload-'request_id'-'cliente_id'-'movimiento_id'-'reserva_id'-'pago_id'-'token')::text);
begin
 select * into v_existente from public.citas_reservadas where request_id=v_request for update;
 if found then if v_existente.request_fingerprint is distinct from v_fingerprint then raise exception using message='REQUEST_ID_PAYLOAD_CONFLICTO'; end if; return jsonb_build_object('ok',true,'reutilizado',true,'reserva_id',v_existente.reserva_id,'token',v_existente.token_ficha); end if;
 if lower(btrim(coalesce(p_payload->>'canal',''))) <> 'directo' or coalesce((p_payload->>'es_gift_card')::boolean,false) or btrim(coalesce(p_payload->>'cupon_promocional',''))<>'' or lower(btrim(coalesce(p_payload->>'tipo_atencion',''))) <> 'sede' then raise exception using message='PERSONALIZADA_SOLO_DIRECTO_PRESENCIAL'; end if;
 if v_personas not between 1 and 5 or v_modalidad not in ('simultanea','consecutiva') or not coalesce((p_payload->>'confirmar_disponibilidad')::boolean,false) then raise exception using message='PERSONALIZADA_INVALIDA'; end if;
 if jsonb_typeof(v_componentes)<>'array' or jsonb_array_length(v_componentes)<>v_personas then raise exception using message='COMPONENTES_POR_PERSONA_INVALIDOS'; end if;
 select round(sum((c->>'precio')::numeric),2), case when v_modalidad='simultanea' then max(duracion) else sum(duracion) end into v_calculado,v_duracion from (select sum((x->>'duracion_min')::int) duracion, x from jsonb_array_elements(v_componentes) p, jsonb_array_elements(p->'componentes') x group by p) q, lateral jsonb_array_elements(q.x) c;
 if coalesce(v_calculado,0)<=0 or coalesce(v_duracion,0)<=0 or exists(select 1 from jsonb_array_elements(v_componentes) p,jsonb_array_elements(p->'componentes') c where btrim(coalesce(c->>'nombre',''))='' or coalesce((c->>'precio')::numeric,0)<=0 or coalesce((c->>'duracion_min')::int,0)<=0) then raise exception using message='COMPONENTE_INVALIDO'; end if;
 if v_final<=0 then v_final:=v_calculado; end if; if v_final<>v_calculado and btrim(coalesce(p_payload->>'motivo_ajuste',''))='' then raise exception using message='AJUSTE_SIN_MOTIVO'; end if;
 select hora_apertura,hora_cierre into v_apertura,v_cierre from public.sedes where nombre=v_sede and activo is true; if not found or v_hora<v_apertura or v_hora+make_interval(mins=>v_duracion)>v_cierre then raise exception using message='HORARIO_FUERA_DE_SEDE'; end if;
 v_adelanto:=case when v_personas=1 then least(10,v_final) else round(v_final*.5,2) end; if coalesce((p_payload->>'monto_pagado')::numeric,0)<v_adelanto then raise exception using message='PAGO_INSUFICIENTE'; end if;
 if v_token !~ '^[A-Za-z0-9_-]{43}$' or v_expira < ((v_fecha+v_hora)+make_interval(mins=>v_duracion)) at time zone 'America/Lima' then raise exception using message='TOKEN_O_EXPIRACION_INVALIDOS'; end if;
 select cliente_id into v_cliente_id from public.clientes where whatsapp_e164=v_whatsapp limit 1; if v_cliente_id is null then v_cliente_id:=btrim(p_payload->>'cliente_id'); insert into public.clientes(cliente_id,cliente,whatsapp,whatsapp_e164,pais_telefono,origen,updated_at) values(v_cliente_id,v_cliente,v_whatsapp,v_whatsapp,upper(p_payload->>'pais_telefono'),'APP_CAJA_FICHA',now()); end if;
 insert into public.caja_movimientos(movimiento_id,fecha,hora,sede,tipo_movimiento,estado,cliente_id,cliente,whatsapp,n_pax,servicio,duracion,monto_servicio,total_cobrar,total_pagado,pendiente,responsable,source_type,source_id) values(v_mov,v_fecha,v_hora,v_sede,'RESERVA_APP','Reservado',v_cliente_id,v_cliente,v_whatsapp,v_personas,'Atención personalizada',v_duracion||' min',v_final,v_final,coalesce((p_payload->>'monto_pagado')::numeric,0),v_final-coalesce((p_payload->>'monto_pagado')::numeric,0),p_payload->>'responsable','APP_CAJA_FICHA',v_res);
 insert into public.citas_reservadas(reserva_id,fecha_cita,hora_cita,sede,cliente_id,cliente,whatsapp,n_pax,personas,servicio,duracion,duracion_min,monto_total,adelanto,saldo_pendiente,estado,source,source_id,estado_ficha,canal,token_ficha,token_expira,servicios_json,request_id,request_fingerprint,atencion_personalizada,modalidad_ejecucion,componentes_por_persona,precio_calculado,precio_final_acordado,diferencia_precio,motivo_ajuste,responsable_ajuste,fecha_ajuste,disponibilidad_confirmada) values(v_res,v_fecha,v_hora,v_sede,v_cliente_id,v_cliente,v_whatsapp,v_personas,v_personas,'Atención personalizada',v_duracion||' min',v_duracion,v_final,coalesce((p_payload->>'monto_pagado')::numeric,0),v_final-coalesce((p_payload->>'monto_pagado')::numeric,0),'PENDIENTE','APP_CAJA_FICHA',v_mov,'pendiente','directo',v_token,v_expira,v_componentes,v_request,v_fingerprint,true,v_modalidad,v_componentes,v_calculado,v_final,v_final-v_calculado,nullif(btrim(p_payload->>'motivo_ajuste'),''),nullif(btrim(p_payload->>'responsable'),''),case when v_final<>v_calculado then now() end,true);
 insert into public.caja_pagos(pago_id,movimiento_id,fecha,hora,sede,tipo_pago,metodo,monto,concepto,numero_operacion) values(v_pago,v_mov,v_fecha,v_hora,v_sede,'ADELANTO_APP',p_payload->>'metodo_pago',(p_payload->>'monto_pagado')::numeric,'Atención personalizada',nullif(p_payload->>'numero_operacion',''));
 return jsonb_build_object('ok',true,'reserva_id',v_res,'token',v_token,'adelanto_requerido',v_adelanto);
end $$;
revoke all on function public.preparar_atencion_personalizada(jsonb) from public,anon,authenticated;
grant execute on function public.preparar_atencion_personalizada(jsonb) to service_role;

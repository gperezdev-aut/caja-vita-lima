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
 if not exists (
   select 1 from pg_constraint
   where conname='chk_citas_personalizadas_modalidad'
     and conrelid='public.citas_reservadas'::regclass
 ) then
  alter table public.citas_reservadas add constraint chk_citas_personalizadas_modalidad check
   (not atencion_personalizada or (modalidad_ejecucion in ('simultanea','consecutiva') and componentes_por_persona is not null and disponibilidad_confirmada));
 end if;
end $$;

-- RPC aislada: no altera preparar_ficha_cita ni el flujo estándar de 013–016.
create or replace function public.preparar_atencion_personalizada(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_request uuid; v_request_text text := btrim(coalesce(p_payload->>'request_id', ''));
 v_existente public.citas_reservadas%rowtype;
 v_personas int := coalesce((p_payload->>'personas')::int,0); v_componentes jsonb:=coalesce(p_payload->'componentes_por_persona','[]'::jsonb);
 v_modalidad text:=lower(btrim(coalesce(p_payload->>'modalidad_ejecucion',''))); v_calculado numeric:=0; v_final numeric:=coalesce((p_payload->>'precio_final_acordado')::numeric,0);
 v_duracion int; v_sede text:=btrim(coalesce(p_payload->>'sede','')); v_fecha date:=(p_payload->>'fecha')::date; v_hora time:=(p_payload->>'hora')::time;
 v_cliente text:=btrim(coalesce(p_payload->>'cliente','')); v_whatsapp text:=btrim(coalesce(p_payload->>'whatsapp_e164','')); v_pais text:=upper(btrim(coalesce(p_payload->>'pais_telefono',''))); v_cliente_id text; v_cliente_id_payload text:=btrim(coalesce(p_payload->>'cliente_id',''));
 v_mov text:=btrim(coalesce(p_payload->>'movimiento_id','')); v_res text:=btrim(coalesce(p_payload->>'reserva_id','')); v_pago text:=btrim(coalesce(p_payload->>'pago_id','')); v_token text:=btrim(coalesce(p_payload->>'token','')); v_expira timestamptz:=(p_payload->>'token_expira')::timestamptz;
 v_adelanto numeric; v_apertura time; v_cierre time; v_componentes_validos boolean := false;
 v_pagado numeric := coalesce((p_payload->>'monto_pagado')::numeric, 0);
 v_metodo text := btrim(coalesce(p_payload->>'metodo_pago', ''));
 v_numero_operacion text := btrim(coalesce(p_payload->>'numero_operacion', ''));
 v_item jsonb; v_persona int; v_componente int := 0; v_total_detalles int; v_asignado_acumulado numeric(12,2) := 0; v_monto_asignado numeric(12,2);
 v_responsable text:=btrim(coalesce(p_payload->>'responsable', ''));
 v_fingerprint text;
begin
 begin
   v_request := v_request_text::uuid;
 exception when others then
   raise exception using errcode='22023', message='REQUEST_ID_INVALIDO';
 end;
 v_fingerprint:=md5((p_payload-'request_id'-'cliente_id'-'movimiento_id'-'reserva_id'-'pago_id'-'token')::text);
 select * into v_existente from public.citas_reservadas where request_id=v_request for update;
 if found then if v_existente.request_fingerprint is distinct from v_fingerprint then raise exception using message='REQUEST_ID_PAYLOAD_CONFLICTO'; end if; return jsonb_build_object('ok',true,'reutilizado',true,'reserva_id',v_existente.reserva_id,'token',v_existente.token_ficha); end if;
 if v_cliente = '' then raise exception using errcode='22023', message='CLIENTE_REQUERIDO'; end if;
 if v_whatsapp !~ '^\+[1-9][0-9]{7,14}$' or v_pais !~ '^[A-Z]{2}$' then raise exception using errcode='22023', message='TELEFONO_E164_INVALIDO'; end if;
 if v_mov = '' or v_res = '' or v_pago = '' then raise exception using errcode='22023', message='IDENTIFICADORES_PREPARACION_INVALIDOS'; end if;
 if lower(btrim(coalesce(p_payload->>'canal',''))) <> 'directo' or coalesce((p_payload->>'es_gift_card')::boolean,false) or btrim(coalesce(p_payload->>'cupon_promocional',''))<>'' or lower(btrim(coalesce(p_payload->>'tipo_atencion',''))) <> 'sede' then raise exception using message='PERSONALIZADA_SOLO_DIRECTO_PRESENCIAL'; end if;
 if v_personas not between 1 and 5 or v_modalidad not in ('simultanea','consecutiva') or not coalesce((p_payload->>'confirmar_disponibilidad')::boolean,false) then raise exception using message='PERSONALIZADA_INVALIDA'; end if;
 if jsonb_typeof(v_componentes)<>'array' or jsonb_array_length(v_componentes)<>v_personas then raise exception using message='COMPONENTES_POR_PERSONA_INVALIDOS'; end if;
 -- La fuente económica de los componentes de catálogo es el catálogo activo.
 -- Los valores enviados por el navegador solo se usan en componentes manuales.
 with personas as (
   select ordinality::int as persona,
     case when coalesce(value->>'persona', '') ~ '^[1-5]$' then (value->>'persona')::int end as persona_declarada,
     value as datos
   from jsonb_array_elements(v_componentes) with ordinality
 ), componentes as (
   select p.persona, p.persona_declarada, c.ordinality::int as posicion, c.value as componente
   from personas p
   cross join lateral jsonb_array_elements(
     case when jsonb_typeof(p.datos->'componentes') = 'array' then p.datos->'componentes' else '[]'::jsonb end
   ) with ordinality as c(value, ordinality)
 ), enriquecidos as (
   select c.persona, c.persona_declarada, c.posicion, c.componente->>'tipo' as tipo,
     case when c.componente->>'tipo' = 'catalogo' then catalogo.nombre else btrim(coalesce(c.componente->>'nombre', '')) end as nombre,
     case when c.componente->>'tipo' = 'catalogo' then catalogo.precio
       when coalesce(c.componente->>'precio', '') ~ '^[0-9]+([.][0-9]{1,2})?$' then (c.componente->>'precio')::numeric end as precio,
     case when c.componente->>'tipo' = 'catalogo' then catalogo.duracion
       when coalesce(c.componente->>'duracion_min', '') ~ '^[1-9][0-9]*$' then (c.componente->>'duracion_min')::int end as duracion,
     case when c.componente->>'tipo' = 'catalogo' then catalogo.codigo else null end as codigo,
     coalesce(catalogo.cantidad, 0) as coincidencias_catalogo
   from componentes c
   left join lateral (
     select count(*) as cantidad, min(btrim(sc.option_name::text)) as nombre,
       min(btrim(sc."CodeId"::text)) as codigo,
       min(case when nullif(btrim(to_jsonb(sc)->>'price_pen'), '') is not null then
             nullif(replace(regexp_replace(to_jsonb(sc)->>'price_pen', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric
           else nullif(replace(regexp_replace(to_jsonb(sc)->>'price', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric end) as precio,
       min(nullif(regexp_replace(sc.duration_min::text, '[^0-9]', '', 'g'), '')::int) as duracion
     from public.stg_services_catalog_v5 sc
     where lower(coalesce(sc.active::text, '')) in ('true', '1', 'yes', 'si', 'sí')
       and btrim(sc."CodeId"::text) = btrim(coalesce(c.componente->>'codigo', ''))
   ) catalogo on c.componente->>'tipo' = 'catalogo'
 ), por_persona as (
   select persona, persona_declarada, count(*) as cantidad_componentes,
     bool_and(tipo in ('catalogo', 'manual') and nombre <> '' and coalesce(precio, 0) > 0 and coalesce(duracion, 0) > 0
       and (tipo <> 'catalogo' or coincidencias_catalogo = 1)) as valido,
     round(sum(precio), 2) as subtotal, sum(duracion) as duracion,
     jsonb_agg(jsonb_strip_nulls(jsonb_build_object('tipo', tipo, 'codigo', codigo, 'nombre', nombre, 'precio', precio, 'duracion_min', duracion)) order by posicion) as normalizados
   from enriquecidos
   group by persona, persona_declarada
 )
 select coalesce(jsonb_agg(jsonb_build_object('persona', persona, 'componentes', normalizados) order by persona), '[]'::jsonb),
   coalesce(round(sum(subtotal), 2), 0),
   case when v_modalidad = 'simultanea' then max(duracion) else sum(duracion) end,
   count(*) = v_personas and bool_and(cantidad_componentes > 0 and valido and persona_declarada = persona)
 into v_componentes, v_calculado, v_duracion, v_componentes_validos
 from por_persona;
 if coalesce(v_componentes_validos, false) is not true or coalesce(v_calculado,0)<=0 or coalesce(v_duracion,0)<=0 then raise exception using message='COMPONENTE_INVALIDO'; end if;
 if v_final<=0 then v_final:=v_calculado; end if;
 if v_final <> round(v_final, 2) then raise exception using errcode='22023', message='PRECIO_FINAL_INVALIDO'; end if;
 if v_final<>v_calculado and btrim(coalesce(p_payload->>'motivo_ajuste',''))='' then raise exception using message='AJUSTE_SIN_MOTIVO'; end if;
 if v_final<>v_calculado and v_responsable='' then raise exception using message='AJUSTE_SIN_RESPONSABLE'; end if;
 select hora_apertura,hora_cierre into v_apertura,v_cierre from public.sedes where nombre=v_sede and activo is true; if not found or v_hora<v_apertura or v_hora+make_interval(mins=>v_duracion)>v_cierre then raise exception using message='HORARIO_FUERA_DE_SEDE'; end if;
 v_adelanto:=case when v_personas=1 then least(10,v_final) else round(v_final*.5,2) end;
 if v_pagado < 0 then raise exception using message='MONTO_PAGADO_NEGATIVO'; end if;
 if v_pagado < v_adelanto then raise exception using message='PAGO_INSUFICIENTE'; end if;
 if v_pagado > v_final then raise exception using message='MONTO_PAGADO_SUPERA_TOTAL'; end if;
 if v_pagado > 0 and v_metodo = '' then raise exception using message='METODO_PAGO_REQUERIDO'; end if;
 if v_pagado > 0 and not exists (select 1 from public.config_listas where lista = 'METODOS_PAGO' and activo is true and upper(btrim(valor)) = upper(v_metodo)) then raise exception using message='METODO_PAGO_NO_PERMITIDO'; end if;
 if v_pagado > 0 and upper(v_metodo) <> 'EFECTIVO' and v_numero_operacion = '' then raise exception using message='NUMERO_OPERACION_REQUERIDO'; end if;
 if v_token !~ '^[A-Za-z0-9_-]{43}$' or v_expira < ((v_fecha+v_hora)+make_interval(mins=>v_duracion)) at time zone 'America/Lima' then raise exception using message='TOKEN_O_EXPIRACION_INVALIDOS'; end if;
 select cliente_id into v_cliente_id from public.clientes where whatsapp_e164=v_whatsapp limit 1; if v_cliente_id is null then if v_cliente_id_payload = '' then raise exception using errcode='22023', message='CLIENTE_ID_REQUERIDO'; end if; v_cliente_id:=v_cliente_id_payload; insert into public.clientes(cliente_id,cliente,whatsapp,whatsapp_e164,pais_telefono,origen,updated_at) values(v_cliente_id,v_cliente,v_whatsapp,v_whatsapp,v_pais,'APP_CAJA_FICHA',now()); end if;
 insert into public.caja_movimientos(movimiento_id,fecha,hora,sede,tipo_movimiento,estado,cliente_id,cliente,whatsapp,n_pax,servicio,duracion,monto_servicio,total_extras,total_cobrar,total_pagado,pendiente,responsable,source_type,source_id) values(v_mov,v_fecha,v_hora,v_sede,'RESERVA_APP','Reservado',v_cliente_id,v_cliente,v_whatsapp,v_personas,'Atención personalizada',v_duracion||' min',v_final,0,v_final,v_pagado,v_final-v_pagado,v_responsable,'APP_CAJA_FICHA',v_res);
 insert into public.citas_reservadas(reserva_id,fecha_cita,hora_cita,sede,cliente_id,cliente,whatsapp,n_pax,personas,servicio,duracion,duracion_min,monto_total,adelanto,metodo_adelanto,saldo_pendiente,estado,source,source_id,estado_ficha,canal,requiere_confirmacion,idioma,token_ficha,token_expira,es_gift_card,servicios_json,observacion,request_id,request_fingerprint,atencion_personalizada,modalidad_ejecucion,componentes_por_persona,precio_calculado,precio_final_acordado,diferencia_precio,motivo_ajuste,responsable_ajuste,fecha_ajuste,disponibilidad_confirmada) values(v_res,v_fecha,v_hora,v_sede,v_cliente_id,v_cliente,v_whatsapp,v_personas,v_personas,'Atención personalizada',v_duracion||' min',v_duracion,v_final,v_pagado,nullif(v_metodo,''),v_final-v_pagado,'PENDIENTE','APP_CAJA_FICHA',v_mov,'pendiente','directo',false,coalesce(nullif(btrim(p_payload->>'idioma'),''),'es'),v_token,v_expira,false,v_componentes,nullif(btrim(p_payload->>'observacion'),''),v_request,v_fingerprint,true,v_modalidad,v_componentes,v_calculado,v_final,v_final-v_calculado,nullif(btrim(p_payload->>'motivo_ajuste'), ''),case when v_final<>v_calculado then v_responsable end,case when v_final<>v_calculado then now() end,true);
 insert into public.caja_pagos(pago_id,movimiento_id,fecha,hora,sede,tipo_pago,metodo,monto,concepto,numero_operacion) values(v_pago,v_mov,v_fecha,v_hora,v_sede,'ADELANTO_APP',v_metodo,v_pagado,'Atención personalizada',nullif(v_numero_operacion,''));
 select count(*) into v_total_detalles
 from jsonb_array_elements(v_componentes) with ordinality as persona(value, persona_orden)
 cross join lateral jsonb_array_elements(persona.value->'componentes') with ordinality as componente(value, componente_orden);
 if v_total_detalles <= 0 then raise exception using message='COMPONENTE_INVALIDO'; end if;
 for v_persona, v_item in
   select (persona.value->>'persona')::int, componente.value
   from jsonb_array_elements(v_componentes) with ordinality as persona(value, persona_orden)
   cross join lateral jsonb_array_elements(persona.value->'componentes') with ordinality as componente(value, componente_orden)
   order by persona.persona_orden, componente.componente_orden
 loop
   v_componente := v_componente + 1;
   if v_componente = v_total_detalles then
     v_monto_asignado := round(v_final - v_asignado_acumulado, 2);
   else
     v_monto_asignado := least(
       round(((v_item->>'precio')::numeric / v_calculado) * v_final, 2),
       greatest(v_final - v_asignado_acumulado, 0)
     );
     v_asignado_acumulado := v_asignado_acumulado + v_monto_asignado;
   end if;
   insert into public.caja_atencion_detalle(detalle_id,movimiento_id,fecha,sede,persona_n,terapista,servicio,duracion,monto_asignado,observacion)
   values(v_res || '-C' || v_componente,v_mov,v_fecha,v_sede,v_persona,'Por asignar',btrim(v_item->>'nombre'),(v_item->>'duracion_min') || ' min',v_monto_asignado,nullif(btrim(p_payload->>'observacion'),''));
 end loop;
 return jsonb_build_object('ok',true,'reserva_id',v_res,'token',v_token,'adelanto_requerido',v_adelanto);
end $$;
revoke all on function public.preparar_atencion_personalizada(jsonb) from public,anon,authenticated;
grant execute on function public.preparar_atencion_personalizada(jsonb) to service_role;

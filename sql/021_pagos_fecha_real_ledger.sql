-- Caja Vita Lima — separación entre fecha operativa y fecha real de cobro.
-- Migración versionada; no incluye backfill histórico.
begin;

create or replace function public.preparar_ficha_cita(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request_id uuid;
  v_fingerprint text;
  v_existente public.citas_reservadas%rowtype;
  v_canal text := lower(btrim(coalesce(p_payload->>'canal', '')));
  v_personas int := coalesce((p_payload->>'personas')::int, 0);
  v_fecha date := (p_payload->>'fecha')::date;
  v_hora time := (p_payload->>'hora')::time;
  v_tipo_atencion text := lower(btrim(coalesce(p_payload->>'tipo_atencion', 'sede')));
  v_sede text := btrim(coalesce(p_payload->>'sede_operativa', p_payload->>'sede', ''));
  v_distrito text := btrim(coalesce(p_payload->>'domicilio_distrito', ''));
  v_direccion text := btrim(coalesce(p_payload->>'domicilio_direccion', ''));
  v_referencia text := btrim(coalesce(p_payload->>'domicilio_referencia', ''));
  v_cliente text := btrim(coalesce(p_payload->>'cliente', ''));
  v_whatsapp text := btrim(coalesce(p_payload->>'whatsapp_e164', ''));
  v_pais text := upper(btrim(coalesce(p_payload->>'pais_telefono', '')));
  v_entrada_servicios jsonb := coalesce(p_payload->'servicios', '[]'::jsonb);
  v_servicios jsonb;
  v_codigos jsonb;
  v_resuelto jsonb;
  v_es_home boolean;
  v_catalogo_valido boolean;
  v_todos_dom boolean;
  v_alguno_dom boolean;
  v_subtotal numeric(12,2);
  v_movilidad numeric(12,2) := 0;
  v_total numeric(12,2);
  v_pagado numeric(12,2) := coalesce((p_payload->>'monto_pagado')::numeric, 0);
  v_metodo_pago text := upper(btrim(coalesce(p_payload->>'metodo_pago', '')));
  v_numero_operacion text := btrim(coalesce(p_payload->>'numero_operacion', ''));
  v_adelanto_requerido numeric(12,2);
  v_requiere_confirmacion boolean;
  v_duracion int;
  v_servicio_resumen text;
  v_apertura time;
  v_cierre time;
  v_cliente_id text;
  v_token text := btrim(coalesce(p_payload->>'token', ''));
  v_token_expira timestamptz := (p_payload->>'token_expira')::timestamptz;
  v_movimiento_id text := btrim(coalesce(p_payload->>'movimiento_id', ''));
  v_reserva_id text := btrim(coalesce(p_payload->>'reserva_id', ''));
  v_pago_id text := btrim(coalesce(p_payload->>'pago_id', ''));
  v_item jsonb;
  v_n int := 0;
  v_instante_cobro timestamp without time zone := now() at time zone 'America/Lima';
begin
  begin
    v_request_id := (p_payload->>'request_id')::uuid;
  exception when others then
    raise exception using errcode = '22023', message = 'REQUEST_ID_INVALIDO';
  end;

  v_fingerprint := md5((p_payload
    - 'request_id' - 'cliente_id' - 'movimiento_id' - 'reserva_id'
    - 'pago_id' - 'token')::text);

  select * into v_existente from public.citas_reservadas
  where request_id = v_request_id for update;
  if found then
    if v_existente.request_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = '23505', message = 'REQUEST_ID_PAYLOAD_CONFLICTO';
    end if;
    return jsonb_build_object(
      'ok', true, 'reutilizado', true, 'reserva_id', v_existente.reserva_id,
      'movimiento_id', v_existente.source_id, 'token', v_existente.token_ficha,
      'requiere_confirmacion', v_existente.requiere_confirmacion
    );
  end if;

  if v_canal <> 'directo'
     or coalesce((p_payload->>'es_gift_card')::boolean, false)
     or btrim(coalesce(p_payload->>'cupon_promocional', '')) <> '' then
    raise exception using errcode = '22023', message = 'PREPARAR_CITA_MVP_SOLO_DIRECTO';
  end if;
  if v_personas not in (1, 2) or v_cliente = '' then
    raise exception using errcode = '22023', message = 'DATOS_PREPARACION_INVALIDOS';
  end if;
  if v_fecha < (now() at time zone 'America/Lima')::date then
    raise exception using errcode = '22023', message = 'FECHA_CITA_PASADA';
  end if;
  if v_whatsapp !~ '^\+[1-9][0-9]{7,14}$' or v_pais !~ '^[A-Z]{2}$' then
    raise exception using errcode = '22023', message = 'TELEFONO_E164_INVALIDO';
  end if;
  if jsonb_typeof(v_entrada_servicios) <> 'array'
     or jsonb_array_length(v_entrada_servicios) = 0 then
    raise exception using errcode = '22023', message = 'SELECCION_SERVICIOS_INVALIDA';
  end if;

  select jsonb_agg(to_jsonb(btrim(item->>'codigo')) order by ord)
    into v_codigos
  from jsonb_array_elements(v_entrada_servicios) with ordinality requested(item, ord);

  v_resuelto := public.caja_catalog_resolve_appointment_v1(v_codigos, v_personas, v_distrito);
  if v_resuelto->'total' = 'null'::jsonb then
    raise exception using errcode = '22023', message = 'MOVILIDAD_HOME_REQUIERE_CONFIRMACION_MANUAL';
  end if;
  v_servicios := v_resuelto->'services';
  v_subtotal := (v_resuelto->>'subtotal')::numeric;
  v_movilidad := (v_resuelto->>'mobility_fee')::numeric;
  v_total := (v_resuelto->>'total')::numeric;
  v_requiere_confirmacion := (v_resuelto->>'requires_confirmation')::boolean;
  v_es_home := coalesce((v_servicios->0->>'category') = 'HOME' or (v_servicios->0->>'modality') = 'HOME', false);

  if (v_es_home and v_tipo_atencion <> 'domicilio')
     or (not v_es_home and v_tipo_atencion <> 'sede') then
    raise exception using errcode = '22023', message = 'TIPO_ATENCION_NO_COINCIDE';
  end if;
  if v_es_home then
    if v_distrito = '' or v_direccion = '' then
      raise exception using errcode = '22023', message = 'DOMICILIO_INCOMPLETO';
    end if;
  else
    v_distrito := ''; v_direccion := ''; v_referencia := '';
  end if;

  select max((item->>'duracion_min')::int), string_agg(item->>'nombre', ' + ' order by ord)
    into v_duracion, v_servicio_resumen
  from jsonb_array_elements(v_servicios) with ordinality resolved(item, ord);

  select s.hora_apertura, s.hora_cierre into v_apertura, v_cierre
  from public.sedes s where s.nombre = v_sede and s.activo is true;
  if not found or v_apertura is null or v_cierre is null then
    raise exception using errcode = '22023', message = 'SEDE_OPERATIVA_INVALIDA';
  end if;
  if v_hora < v_apertura or v_hora + make_interval(mins => v_duracion) > v_cierre then
    raise exception using errcode = '22023', message = 'HORARIO_FUERA_DE_SEDE';
  end if;
  v_adelanto_requerido := case
    when v_tipo_atencion = 'domicilio' or v_personas = 2 then round(v_total * 0.50, 2)
    else least(10, v_total)
  end;
  if v_pagado < 0 then
    raise exception using errcode = '22023', message = 'MONTO_PAGADO_NEGATIVO';
  end if;
  if v_pagado > v_total then
    raise exception using errcode = '22023', message = 'MONTO_PAGADO_SUPERA_TOTAL';
  end if;
  if v_pagado < v_adelanto_requerido then
    raise exception using errcode = '22023', message = 'PAGO_INSUFICIENTE';
  end if;
  if v_pagado > 0 and v_metodo_pago = '' then
    raise exception using errcode = '22023', message = 'METODO_PAGO_REQUERIDO';
  end if;
  if v_pagado > 0 and not exists (
    select 1 from public.config_listas l
    where l.lista = 'METODOS_PAGO' and l.activo is true
      and upper(btrim(l.valor)) = v_metodo_pago
  ) then
    raise exception using errcode = '22023', message = 'METODO_PAGO_NO_PERMITIDO';
  end if;
  if v_pagado > 0 and v_metodo_pago <> 'EFECTIVO' and v_numero_operacion = '' then
    raise exception using errcode = '22023', message = 'NUMERO_OPERACION_REQUERIDO';
  end if;
  -- La acción calcula este instante como inicio + duración. Es válido que
  -- coincida exactamente con el final; solo se rechaza una expiración previa.
  if v_token !~ '^[A-Za-z0-9_-]{43}$' or v_token_expira is null
     or v_token_expira < ((v_fecha + v_hora) + make_interval(mins => v_duracion)) at time zone 'America/Lima' then
    raise exception using errcode = '22023', message = 'TOKEN_O_EXPIRACION_INVALIDOS';
  end if;
  if v_movimiento_id = '' or v_reserva_id = '' or v_pago_id = '' then
    raise exception using errcode = '22023', message = 'IDENTIFICADORES_OPERACION_REQUERIDOS';
  end if;

  select c.cliente_id into v_cliente_id from public.clientes c where c.whatsapp_e164 = v_whatsapp limit 1;
  if v_cliente_id is null then
    v_cliente_id := btrim(coalesce(p_payload->>'cliente_id', ''));
    if v_cliente_id = '' then raise exception using errcode = '22023', message = 'CLIENTE_ID_REQUERIDO'; end if;
    insert into public.clientes (cliente_id, cliente, whatsapp, whatsapp_e164, pais_telefono, ultima_sede, ultimo_servicio, origen, updated_at)
    values (v_cliente_id, v_cliente, v_whatsapp, v_whatsapp, v_pais, v_sede, v_servicio_resumen, 'APP_CAJA_FICHA', now());
  else
    update public.clientes set cliente = v_cliente, whatsapp = v_whatsapp, pais_telefono = v_pais,
      ultima_sede = v_sede, ultimo_servicio = v_servicio_resumen, updated_at = now()
    where cliente_id = v_cliente_id;
  end if;

  insert into public.caja_movimientos (
    movimiento_id, fecha, hora, sede, tipo_movimiento, estado, cliente_id, cliente, whatsapp, n_pax,
    servicio, duracion, monto_servicio, adelanto_prev, metodo_adelanto_prev, total_cobrar, total_pagado,
    total_extras, pendiente, responsable, source_type, source_id, observacion, estado_boleta, numero_boleta
  ) values (
    v_movimiento_id, v_fecha, v_hora, v_sede, 'RESERVA_APP',
    case when v_requiere_confirmacion then 'Pendiente de confirmación' else 'Reservado' end,
    v_cliente_id, v_cliente, v_whatsapp, v_personas, v_servicio_resumen, v_duracion || ' min',
    v_subtotal, v_pagado, nullif(v_metodo_pago, ''), v_total, v_pagado,
    v_movilidad, greatest(v_total - v_pagado, 0), nullif(btrim(p_payload->>'responsable'), ''),
    'APP_CAJA_FICHA', v_reserva_id, nullif(btrim(p_payload->>'observacion'), ''), 'No aplica', null
  );

  insert into public.citas_reservadas (
    reserva_id, fecha_cita, hora_cita, sede, cliente_id, cliente, whatsapp, n_pax, personas, servicio,
    duracion, duracion_min, monto_total, adelanto, metodo_adelanto, saldo_pendiente, estado, source,
    source_id, estado_ficha, canal, requiere_confirmacion, confirmado_en, idioma, token_ficha, token_expira,
    es_gift_card, cupon_promocional, servicios_json, observacion, tipo_atencion, sede_operativa,
    domicilio_distrito, domicilio_direccion, domicilio_referencia, costo_movilidad, request_id, request_fingerprint
  ) values (
    v_reserva_id, v_fecha, v_hora, v_sede, v_cliente_id, v_cliente, v_whatsapp, v_personas, v_personas,
    v_servicio_resumen, v_duracion || ' min', v_duracion, v_total, v_pagado,
    nullif(v_metodo_pago, ''), greatest(v_total - v_pagado, 0), 'PENDIENTE',
    'APP_CAJA_FICHA', v_movimiento_id, 'pendiente', 'directo', v_requiere_confirmacion, null,
    coalesce(nullif(btrim(p_payload->>'idioma'), ''), 'es'), v_token, v_token_expira, false, null,
    v_servicios, nullif(btrim(p_payload->>'observacion'), ''), v_tipo_atencion, v_sede,
    nullif(v_distrito, ''), nullif(v_direccion, ''), nullif(v_referencia, ''), v_movilidad,
    v_request_id, v_fingerprint
  );

  insert into public.caja_pagos (pago_id, movimiento_id, fecha, hora, sede, tipo_pago, metodo, metodo_detalle, monto, concepto, numero_operacion)
  values (v_pago_id, v_movimiento_id, v_instante_cobro::date, v_instante_cobro::time, v_sede, 'ADELANTO_APP',
    v_metodo_pago, null, v_pagado, v_servicio_resumen, nullif(v_numero_operacion, ''));

  for v_item in select value from jsonb_array_elements(v_servicios) loop
    v_n := v_n + 1;
    insert into public.caja_atencion_detalle (detalle_id, movimiento_id, fecha, sede, persona_n, terapista, servicio, duracion, monto_asignado, observacion)
    values (v_reserva_id || '-P' || v_n, v_movimiento_id, v_fecha, v_sede, v_n, 'Por asignar',
      btrim(v_item->>'nombre'), (v_item->>'duracion_min') || ' min', (v_item->>'precio')::numeric,
      nullif(btrim(p_payload->>'observacion'), ''));
  end loop;

  return jsonb_build_object('ok', true, 'reutilizado', false, 'reserva_id', v_reserva_id,
    'movimiento_id', v_movimiento_id, 'token', v_token,
    'adelanto_requerido', v_adelanto_requerido, 'requiere_confirmacion', v_requiere_confirmacion);
exception
  when unique_violation then
    if exists (select 1 from public.citas_reservadas where request_id = v_request_id) then
      select * into v_existente from public.citas_reservadas where request_id = v_request_id;
      if v_existente.request_fingerprint = v_fingerprint then
        return jsonb_build_object('ok', true, 'reutilizado', true, 'reserva_id', v_existente.reserva_id,
          'movimiento_id', v_existente.source_id, 'token', v_existente.token_ficha,
          'requiere_confirmacion', v_existente.requiere_confirmacion);
      end if;
      raise exception using errcode = '23505', message = 'REQUEST_ID_PAYLOAD_CONFLICTO';
    end if;
    raise;
end;
$$;

create or replace function public.preparar_atencion_personalizada(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
 v_instante_cobro timestamp without time zone := now() at time zone 'America/Lima';
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
 if (select count(*) from public.caja_catalog_active_services_read_v1()) <> 50
    or (select count(*) from public.caja_catalog_home_policy_read_v1()) <> 6 then
   raise exception using message='CAJA_CATALOG_ACTIVE_SNAPSHOT_INVALID';
 end if;
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
     from public.caja_catalog_active_services_legacy_shape_v1 sc
     where sc.active is true
       and sc.selection_rule = 'ONE_PERSON'
       and sc.reservation_behavior = 'APPOINTMENT'
       and sc.category <> 'HOME' and sc.modality <> 'HOME'
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
 insert into public.caja_pagos(pago_id,movimiento_id,fecha,hora,sede,tipo_pago,metodo,monto,concepto,numero_operacion) values(v_pago,v_mov,v_instante_cobro::date,v_instante_cobro::time,v_sede,'ADELANTO_APP',v_metodo,v_pagado,'Atención personalizada',nullif(v_numero_operacion,''));
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

-- total_pagado es un acumulado operativo del movimiento. El eje temporal
-- financiero diario/mensual es exclusivamente caja_pagos.fecha.
comment on column public.caja_movimientos.total_pagado is
  'Acumulado operativo conciliable con caja_pagos por movimiento_id; no es fuente temporal de caja diaria.';

create index if not exists idx_pagos_fecha_sede
  on public.caja_pagos(fecha, sede);

create or replace view public.vista_dashboard_resumen_general as
select
  (select count(*) from public.clientes) as total_clientes,
  (select count(*) from public.caja_movimientos) as total_movimientos,
  -- Nombre heredado por compatibilidad; el monto ya proviene del ledger.
  (select coalesce(sum(monto), 0) from public.caja_pagos) as total_ingresos_movimientos,
  (select count(*) from public.caja_pagos) as total_pagos,
  (select coalesce(sum(monto), 0) from public.caja_pagos) as total_ingresos_pagos,
  (select count(*) from public.caja_salidas) as total_salidas_registros,
  (select coalesce(sum(monto), 0) from public.caja_salidas) as total_salidas,
  (select count(*) from public.gift_cards) as total_gift_cards,
  (select coalesce(sum(monto), 0) from public.gift_cards) as total_gift_cards_monto,
  (select count(*) from public.cupones_convenios) as total_cupones_convenios,
  (select count(*) from public.migracion_revision where estado_revision = 'PENDIENTE') as total_revision_pendiente;

create or replace view public.vista_ingresos_por_tipo_movimiento as
with operaciones as (
  select tipo_movimiento, count(*) as cantidad_movimientos
  from public.caja_movimientos
  group by tipo_movimiento
), ingresos as (
  select m.tipo_movimiento, coalesce(sum(p.monto), 0) as total
  from public.caja_pagos p
  left join public.caja_movimientos m on m.movimiento_id = p.movimiento_id
  group by m.tipo_movimiento
)
select
  coalesce(o.tipo_movimiento, i.tipo_movimiento) as tipo_movimiento,
  coalesce(o.cantidad_movimientos, 0) as cantidad_movimientos,
  coalesce(i.total, 0) as total
from operaciones o
full outer join ingresos i on i.tipo_movimiento is not distinct from o.tipo_movimiento
order by total desc;

create or replace view public.vista_ingresos_por_fecha as
with operaciones as (
  select fecha, sede, count(*) as cantidad_movimientos,
    coalesce(sum(pendiente), 0) as total_pendiente
  from public.caja_movimientos
  group by fecha, sede
), ingresos as (
  select fecha, sede, coalesce(sum(monto), 0) as total_pagado
  from public.caja_pagos
  group by fecha, sede
)
select
  coalesce(o.fecha, i.fecha) as fecha,
  coalesce(o.sede, i.sede) as sede,
  coalesce(o.cantidad_movimientos, 0) as cantidad_movimientos,
  coalesce(i.total_pagado, 0) as total_pagado,
  coalesce(o.total_pendiente, 0) as total_pendiente
from operaciones o
full outer join ingresos i on i.fecha is not distinct from o.fecha and i.sede is not distinct from o.sede
order by fecha desc, sede;

create or replace view public.vista_ingresos_por_mes as
with operaciones as (
  select date_trunc('month', fecha)::date as mes, sede,
    count(*) as cantidad_movimientos,
    coalesce(sum(pendiente), 0) as total_pendiente
  from public.caja_movimientos
  where fecha is not null
  group by date_trunc('month', fecha)::date, sede
), ingresos as (
  select date_trunc('month', fecha)::date as mes, sede,
    coalesce(sum(monto), 0) as total_pagado
  from public.caja_pagos
  where fecha is not null
  group by date_trunc('month', fecha)::date, sede
)
select
  coalesce(o.mes, i.mes) as mes,
  coalesce(o.sede, i.sede) as sede,
  coalesce(o.cantidad_movimientos, 0) as cantidad_movimientos,
  coalesce(i.total_pagado, 0) as total_pagado,
  coalesce(o.total_pendiente, 0) as total_pendiente
from operaciones o
full outer join ingresos i on i.mes = o.mes and i.sede is not distinct from o.sede
order by mes desc, sede;

create or replace view public.vista_resultado_neto_por_mes as
with ingresos as (
  select date_trunc('month', fecha)::date as mes, sede,
    coalesce(sum(monto), 0) as total_ingresos
  from public.caja_pagos
  where fecha is not null
  group by date_trunc('month', fecha)::date, sede
), salidas as (
  select date_trunc('month', fecha)::date as mes, sede,
    coalesce(sum(monto), 0) as total_salidas
  from public.caja_salidas
  where fecha is not null
  group by date_trunc('month', fecha)::date, sede
)
select
  coalesce(i.mes, s.mes) as mes,
  coalesce(i.sede, s.sede) as sede,
  coalesce(i.total_ingresos, 0) as total_ingresos,
  coalesce(s.total_salidas, 0) as total_salidas,
  coalesce(i.total_ingresos, 0) - coalesce(s.total_salidas, 0) as resultado_neto
from ingresos i
full outer join salidas s on s.mes = i.mes and s.sede is not distinct from i.sede
order by mes desc, sede;

create or replace view public.vista_ingresos_diarios_por_metodo as
select
  fecha,
  sede,
  case
    when upper(btrim(coalesce(metodo, ''))) = 'EFECTIVO' then 'EFECTIVO'
    when upper(btrim(coalesce(metodo, ''))) like '%YAPE%' then 'YAPE'
    when upper(btrim(coalesce(metodo, ''))) like '%PLIN%' then 'PLIN'
    when upper(btrim(coalesce(metodo, ''))) like '%IZIPAY%'
      or upper(btrim(coalesce(metodo, ''))) = 'POS' then 'IZIPAY POS'
    when upper(btrim(coalesce(metodo, ''))) like '%BCP%' then 'BCP'
    else 'OTRO'
  end as metodo,
  count(*) as cantidad_pagos,
  coalesce(sum(monto), 0) as total
from public.caja_pagos
where fecha is not null
group by fecha, sede, 3;

create or replace view public.vista_reporte_financiero_mensual as
with pagos as (
  select
    date_trunc('month', p.fecha)::date as mes,
    p.sede,
    sum(case when m.tipo_movimiento in (
      'ATENCION_HISTORICA', 'RESERVA_APP', 'ATENCION_APP'
    ) then coalesce(p.monto, 0) else 0 end) as ingresos_servicios,
    sum(case when m.tipo_movimiento = 'GIFT_CARD_VENTA' then coalesce(p.monto, 0) else 0 end) as ingresos_gift_cards,
    sum(case when m.tipo_movimiento = 'PRESTAMO_CAJA_INGRESO' then coalesce(p.monto, 0) else 0 end) as prestamos_caja,
    sum(case when m.tipo_movimiento = 'CUPONIDAD' then coalesce(p.monto, 0) else 0 end) as ingresos_cuponidad_en_caja,
    sum(case when m.tipo_movimiento is null or m.tipo_movimiento not in (
      'ATENCION_HISTORICA', 'RESERVA_APP', 'ATENCION_APP',
      'GIFT_CARD_VENTA', 'PRESTAMO_CAJA_INGRESO', 'CUPONIDAD'
    ) then coalesce(p.monto, 0) else 0 end) as otros_ingresos,
    sum(coalesce(p.monto, 0)) as total_ingresos_confirmados
  from public.caja_pagos p
  left join public.caja_movimientos m on m.movimiento_id = p.movimiento_id
  where p.fecha is not null
  group by date_trunc('month', p.fecha)::date, p.sede
), movimientos_operativos as (
  select date_trunc('month', fecha)::date as mes, sede, count(*) as total_movimientos
  from public.caja_movimientos
  where fecha is not null
  group by date_trunc('month', fecha)::date, sede
), salidas as (
  select date_trunc('month', fecha)::date as mes, sede,
    sum(coalesce(monto, 0)) as total_salidas,
    count(*) as total_salidas_registros
  from public.caja_salidas
  where fecha is not null
  group by date_trunc('month', fecha)::date, sede
), cupones as (
  select date_trunc('month', fecha)::date as mes, sede,
    sum(case when plataforma = 'Bee Beneficios' then coalesce(monto_reconocido, 0) else 0 end) as bee_monto_reconocido,
    sum(case when plataforma = 'Bee Beneficios' then coalesce(monto_cobrado_tienda, 0) else 0 end) as bee_cobrado_tienda,
    sum(case when plataforma = 'Cuponidad' then coalesce(monto_reconocido, 0) else 0 end) as cuponidad_monto_reconocido,
    sum(case when plataforma = 'Cuponidad' then coalesce(monto_cobrado_tienda, 0) else 0 end) as cuponidad_cobrado_tienda,
    count(*) as total_cupones_convenios
  from public.cupones_convenios
  where fecha is not null
  group by date_trunc('month', fecha)::date, sede
), revision_limpia as (
  select case when fecha_original ~ '^\d{4}-\d{2}-\d{2}$' then fecha_original::date end as fecha_revision,
    coalesce(monto_ingreso_detectado, 0) as monto_ingreso_detectado,
    coalesce(monto_salida_detectado, 0) as monto_salida_detectado
  from public.migracion_revision
  where estado_revision = 'PENDIENTE'
), revision as (
  select date_trunc('month', fecha_revision)::date as mes, 'SIN_SEDE'::text as sede,
    count(*) as pendientes_revision,
    sum(monto_ingreso_detectado) as monto_ingreso_pendiente_revision,
    sum(monto_salida_detectado) as monto_salida_pendiente_revision
  from revision_limpia
  where fecha_revision is not null
  group by date_trunc('month', fecha_revision)::date
), base_meses as (
  select mes, sede from pagos
  union select mes, sede from movimientos_operativos
  union select mes, sede from salidas
  union select mes, sede from cupones
  union select mes, sede from revision
)
select
  b.mes, b.sede,
  coalesce(p.ingresos_servicios, 0) as ingresos_servicios,
  coalesce(p.ingresos_gift_cards, 0) as ingresos_gift_cards,
  coalesce(p.prestamos_caja, 0) as prestamos_caja,
  coalesce(p.ingresos_cuponidad_en_caja, 0) as ingresos_cuponidad_en_caja,
  coalesce(p.otros_ingresos, 0) as otros_ingresos,
  coalesce(p.total_ingresos_confirmados, 0) as total_ingresos_confirmados,
  coalesce(s.total_salidas, 0) as total_salidas,
  coalesce(p.total_ingresos_confirmados, 0) - coalesce(s.total_salidas, 0) as resultado_neto_confirmado,
  coalesce(c.bee_monto_reconocido, 0) as bee_monto_reconocido,
  coalesce(c.bee_cobrado_tienda, 0) as bee_cobrado_tienda,
  coalesce(c.cuponidad_monto_reconocido, 0) as cuponidad_monto_reconocido,
  coalesce(c.cuponidad_cobrado_tienda, 0) as cuponidad_cobrado_tienda,
  coalesce(c.total_cupones_convenios, 0) as total_cupones_convenios,
  coalesce(r.pendientes_revision, 0) as pendientes_revision,
  coalesce(r.monto_ingreso_pendiente_revision, 0) as monto_ingreso_pendiente_revision,
  coalesce(r.monto_salida_pendiente_revision, 0) as monto_salida_pendiente_revision,
  coalesce(mo.total_movimientos, 0) as total_movimientos,
  coalesce(s.total_salidas_registros, 0) as total_salidas_registros,
  coalesce(p.total_ingresos_confirmados, 0) - coalesce(p.prestamos_caja, 0)
    - coalesce(s.total_salidas, 0) as resultado_neto_operativo
from base_meses b
left join pagos p on p.mes = b.mes and p.sede is not distinct from b.sede
left join movimientos_operativos mo on mo.mes = b.mes and mo.sede is not distinct from b.sede
left join salidas s on s.mes = b.mes and s.sede is not distinct from b.sede
left join cupones c on c.mes = b.mes and c.sede is not distinct from b.sede
left join revision r on r.mes = b.mes and r.sede is not distinct from b.sede
order by b.mes desc, b.sede;

comment on column public.caja_cierres.caja_esperada is
  'NULL significa no calculable: caja_salidas no registra método y no permite derivar caja física.';
comment on column public.caja_cierres.diferencia is
  'NULL significa no calculable: no comparar efectivo contado con ingresos que incluyen pagos digitales.';

revoke all on function public.preparar_ficha_cita(jsonb) from public, anon, authenticated;
revoke all on function public.preparar_atencion_personalizada(jsonb) from public, anon, authenticated;
grant execute on function public.preparar_ficha_cita(jsonb) to service_role;
grant execute on function public.preparar_atencion_personalizada(jsonb) to service_role;

commit;

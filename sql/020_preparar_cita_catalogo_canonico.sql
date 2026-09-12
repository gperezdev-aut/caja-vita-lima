-- Fase 3B.1-A. Aplicar manualmente solo después de revisión y autorización.
-- Frontera privada de lectura para Preparar cita; no muta el snapshot.
begin;

create or replace function public.caja_catalog_active_services_read_v1()
returns table (
  service_code text,
  name_es text,
  duration_min integer,
  price_pen numeric,
  category text,
  commercial_group text,
  modality text,
  people_min integer,
  people_max integer,
  selection_rule text,
  reservation_behavior text,
  price_version text,
  valid_from timestamptz,
  valid_to timestamptz,
  release_id text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    s.service_code, s.name_es, s.duration_min, s.price_pen, s.category,
    s.commercial_group, s.modality, s.people_min, s.people_max,
    s.selection_rule, s.reservation_behavior, s.price_version,
    s.valid_from, s.valid_to, s.release_id
  from public.caja_catalog_releases r
  join public.caja_catalog_services s on s.release_id = r.release_id
  where r.active is true and s.active is true
  order by s.service_code;
$$;

create or replace function public.caja_catalog_home_policy_read_v1()
returns table (
  scope text,
  district_code text,
  district_name text,
  district_normalized text,
  pricing_mode text,
  fee_pen numeric,
  requires_confirmation boolean,
  policy_id text,
  policy_sha256 text,
  release_id text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    h.scope, h.district_code, h.district_name, h.district_normalized,
    h.pricing_mode, h.fee_pen, h.requires_confirmation,
    h.policy_id, h.policy_sha256, h.release_id
  from public.caja_catalog_releases r
  join public.caja_catalog_home_policy h on h.release_id = r.release_id
  where r.active is true and h.active is true
  order by case when h.scope = 'DEFAULT' then 1 else 0 end, h.rule_key;
$$;

-- Resolución transaccional reutilizable por las RPC de guardado. Devuelve
-- exclusivamente datos recalculados desde el snapshot local activo; ignora
-- cualquier nombre, precio, duración, release o versión enviados por cliente.
create or replace function public.caja_catalog_resolve_appointment_v1(
  p_service_codes jsonb,
  p_people integer,
  p_district text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_release text;
  v_services jsonb;
  v_count integer;
  v_all_home boolean;
  v_any_home boolean;
  v_selection_valid boolean;
  v_district text;
  v_policy public.caja_catalog_home_policy%rowtype;
  v_subtotal numeric(12,2);
begin
  if p_people not in (1, 2) or jsonb_typeof(p_service_codes) <> 'array'
     or jsonb_array_length(p_service_codes) = 0 then
    raise exception 'CAJA_APPOINTMENT_SELECTION_INVALID';
  end if;

  select r.release_id into v_release
  from public.caja_catalog_releases r
  where r.active is true;
  if v_release is null then raise exception 'CAJA_CATALOG_ACTIVE_RELEASE_MISSING'; end if;
  if (select count(*) from public.caja_catalog_services s where s.release_id = v_release and s.active) <> 50 then
    raise exception 'CAJA_CATALOG_ACTIVE_SNAPSHOT_INVALID';
  end if;
  if (select count(*) from public.caja_catalog_home_policy h where h.release_id = v_release and h.active) <> 6 then
    raise exception 'CAJA_CATALOG_ACTIVE_SNAPSHOT_INVALID';
  end if;

  with requested as (
    select btrim(value #>> '{}') service_code, ord
    from jsonb_array_elements(p_service_codes) with ordinality x(value, ord)
  ), resolved as (
    select q.ord, s.*
    from requested q
    left join public.caja_catalog_services s
      on s.release_id = v_release and s.active and s.service_code = q.service_code
  )
  select
    count(*) filter (where service_code is not null),
    bool_and(category = 'HOME' or modality = 'HOME'),
    bool_or(category = 'HOME' or modality = 'HOME'),
    round(sum(price_pen), 2),
    jsonb_agg(jsonb_build_object(
      'codigo', service_code,
      'nombre', name_es,
      'duracion_min', duration_min,
      'precio', price_pen,
      'release_id', release_id,
      'price_version', price_version,
      'category', category,
      'modality', modality,
      'people_min', people_min,
      'people_max', people_max,
      'selection_rule', selection_rule,
      'reservation_behavior', reservation_behavior
    ) order by ord)
  into v_count, v_all_home, v_any_home, v_subtotal, v_services
  from resolved;

  if v_count <> jsonb_array_length(p_service_codes) or v_any_home <> v_all_home then
    raise exception 'CAJA_APPOINTMENT_SERVICE_INVALID';
  end if;

  select case
    when v_all_home then
      jsonb_array_length(v_services) = p_people
      and not exists (select 1 from jsonb_array_elements(v_services) x where x->>'selection_rule' <> 'HOME_FLOW' or x->>'reservation_behavior' <> 'HOME_APPOINTMENT' or p_people < (x->>'people_min')::int or p_people > (x->>'people_max')::int)
    when p_people = 1 then
      jsonb_array_length(v_services) = 1
      and v_services->0->>'selection_rule' = 'ONE_PERSON'
      and v_services->0->>'reservation_behavior' = 'APPOINTMENT'
    when jsonb_array_length(v_services) = 1 then
      v_services->0->>'selection_rule' = 'FIXED_TWO_PACKAGE'
      and v_services->0->>'reservation_behavior' = 'APPOINTMENT'
      and (v_services->0->>'people_min')::int = 2
      and (v_services->0->>'people_max')::int = 2
    else
      jsonb_array_length(v_services) = 2
      and not exists (select 1 from jsonb_array_elements(v_services) x where x->>'selection_rule' <> 'ONE_PERSON' or x->>'reservation_behavior' <> 'APPOINTMENT')
  end into v_selection_valid;
  if not coalesce(v_selection_valid, false) then raise exception 'CAJA_APPOINTMENT_SELECTION_INVALID'; end if;

  if not v_all_home then
    return jsonb_build_object('release_id', v_release, 'services', v_services,
      'subtotal', v_subtotal, 'mobility_fee', 0, 'total', v_subtotal,
      'requires_confirmation', false);
  end if;

  v_district := btrim(regexp_replace(upper(translate(coalesce(p_district, ''),
    'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNAEIOUUN')), '[^A-Z0-9]+', ' ', 'g'));
  select h.* into v_policy
  from public.caja_catalog_home_policy h
  where h.release_id = v_release and h.active
    and h.scope = 'DISTRICT' and h.district_normalized = v_district;
  if not found then
    select h.* into v_policy from public.caja_catalog_home_policy h
    where h.release_id = v_release and h.active and h.scope = 'DEFAULT';
  end if;
  if not found then raise exception 'CAJA_HOME_POLICY_MISSING'; end if;

  if v_policy.pricing_mode = 'MANUAL_CONFIRMATION' then
    return jsonb_build_object('release_id', v_release, 'services', v_services,
      'subtotal', v_subtotal, 'mobility_fee', null, 'total', null,
      'requires_confirmation', true, 'policy_id', v_policy.policy_id,
      'policy_sha256', v_policy.policy_sha256);
  end if;
  return jsonb_build_object('release_id', v_release, 'services', v_services,
    'subtotal', v_subtotal, 'mobility_fee', v_policy.fee_pen,
    'total', round(v_subtotal + v_policy.fee_pen, 2),
    'requires_confirmation', v_policy.requires_confirmation,
    'policy_id', v_policy.policy_id, 'policy_sha256', v_policy.policy_sha256);
end;
$$;

-- Las RPC transaccionales 016/017 se mantienen como contrato de escritura,
-- pero su fuente de catálogo se redirige a esta proyección del snapshot local.
-- La forma legacy queda encapsulada dentro de SQL y nunca se expone al cliente.
create or replace view public.caja_catalog_active_services_legacy_shape_v1 as
select
  s.service_code as "CodeId",
  s.name_es as option_name,
  s.duration_min,
  s.price_pen,
  s.price_pen as price,
  s.active,
  s.category,
  s.modality,
  s.people_min,
  s.people_max,
  s.selection_rule,
  s.reservation_behavior,
  s.release_id,
  s.price_version
from public.caja_catalog_releases r
join public.caja_catalog_services s on s.release_id = r.release_id
where r.active is true and s.active is true;

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
  values (v_pago_id, v_movimiento_id, v_fecha, v_hora, v_sede, 'ADELANTO_APP',
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

create or replace function public.caja_preparar_cita_catalog_metadata_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_release text;
begin
  if new.source <> 'APP_CAJA_FICHA' then return new; end if;
  select release_id into v_release from public.caja_catalog_releases where active;
  if v_release is null then raise exception 'CAJA_CATALOG_ACTIVE_RELEASE_MISSING'; end if;

  if not coalesce(new.atencion_personalizada, false) then
    select jsonb_agg(
      item.value || jsonb_build_object('release_id', s.release_id, 'price_version', s.price_version)
      order by item.ordinality
    ) into new.servicios_json
    from jsonb_array_elements(coalesce(new.servicios_json, '[]'::jsonb)) with ordinality item(value, ordinality)
    join public.caja_catalog_services s
      on s.release_id = v_release and s.active and s.service_code = item.value->>'codigo';
    if new.servicios_json is null then raise exception 'CAJA_CATALOG_PERSISTENCE_METADATA_INVALID'; end if;
  else
    select jsonb_agg(
      persona.value || jsonb_build_object('componentes', (
        select jsonb_agg(
          case when component.value->>'tipo' = 'catalogo'
            then component.value || jsonb_build_object('release_id', s.release_id, 'price_version', s.price_version)
            else component.value end
          order by component.ordinality
        )
        from jsonb_array_elements(persona.value->'componentes') with ordinality component(value, ordinality)
        left join public.caja_catalog_services s
          on s.release_id = v_release and s.active and s.service_code = component.value->>'codigo'
      )) order by persona.ordinality
    ) into new.componentes_por_persona
    from jsonb_array_elements(coalesce(new.componentes_por_persona, '[]'::jsonb)) with ordinality persona(value, ordinality);
    new.servicios_json := new.componentes_por_persona;
  end if;
  return new;
end;
$$;

drop trigger if exists caja_preparar_cita_catalog_metadata on public.citas_reservadas;
create trigger caja_preparar_cita_catalog_metadata
before insert on public.citas_reservadas
for each row execute function public.caja_preparar_cita_catalog_metadata_v1();

revoke all on function public.caja_catalog_active_services_read_v1() from public, anon, authenticated;
revoke all on function public.caja_catalog_home_policy_read_v1() from public, anon, authenticated;
revoke all on function public.caja_catalog_resolve_appointment_v1(jsonb, integer, text) from public, anon, authenticated;
revoke all on public.caja_catalog_active_services_legacy_shape_v1 from public, anon, authenticated, service_role;
revoke all on function public.caja_preparar_cita_catalog_metadata_v1() from public, anon, authenticated;
revoke all on function public.preparar_ficha_cita(jsonb) from public, anon, authenticated;
revoke all on function public.preparar_atencion_personalizada(jsonb) from public, anon, authenticated;
grant execute on function public.caja_catalog_active_services_read_v1() to service_role;
grant execute on function public.caja_catalog_home_policy_read_v1() to service_role;
grant execute on function public.caja_catalog_resolve_appointment_v1(jsonb, integer, text) to service_role;
grant execute on function public.preparar_ficha_cita(jsonb) to service_role;
grant execute on function public.preparar_atencion_personalizada(jsonb) to service_role;

commit;

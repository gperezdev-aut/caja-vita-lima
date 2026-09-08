-- ============================================================
-- Caja Vita Lima — Supabase SQL v15
-- Soporte para citas a domicilio. No modifica las migraciones 013/014.
-- Ejecutar después de 014. Esta migración no se ejecuta desde la aplicación.
-- ============================================================

alter table public.citas_reservadas
  add column if not exists tipo_atencion text default 'sede',
  add column if not exists sede_operativa text,
  add column if not exists domicilio_distrito text,
  add column if not exists domicilio_direccion text,
  add column if not exists domicilio_referencia text,
  add column if not exists costo_movilidad numeric(12,2) default 0;

update public.citas_reservadas
set tipo_atencion = coalesce(nullif(tipo_atencion, ''), 'sede'),
    sede_operativa = coalesce(nullif(sede_operativa, ''), sede),
    costo_movilidad = coalesce(costo_movilidad, 0)
where tipo_atencion is null or tipo_atencion = ''
   or sede_operativa is null or sede_operativa = ''
   or costo_movilidad is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'citas_reservadas_tipo_atencion_check'
      and conrelid = 'public.citas_reservadas'::regclass
  ) then
    alter table public.citas_reservadas
      add constraint citas_reservadas_tipo_atencion_check
      check (tipo_atencion in ('sede', 'domicilio'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'citas_reservadas_costo_movilidad_check'
      and conrelid = 'public.citas_reservadas'::regclass
  ) then
    alter table public.citas_reservadas
      add constraint citas_reservadas_costo_movilidad_check
      check (costo_movilidad >= 0);
  end if;
end;
$$;

-- Sustituye la RPC de 014 conservando su firma y su contrato atómico.
create or replace function public.preparar_ficha_cita(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_canal text := lower(btrim(coalesce(p_payload->>'canal', '')));
  v_personas int := coalesce((p_payload->>'personas')::int, 0);
  v_fecha date := (p_payload->>'fecha')::date;
  v_hora time := (p_payload->>'hora')::time;
  v_tipo_atencion text := lower(btrim(coalesce(p_payload->>'tipo_atencion', 'sede')));
  v_sede_operativa text := btrim(coalesce(p_payload->>'sede_operativa', p_payload->>'sede', ''));
  v_sede text;
  v_distrito text := btrim(coalesce(p_payload->>'domicilio_distrito', ''));
  v_direccion text := btrim(coalesce(p_payload->>'domicilio_direccion', ''));
  v_referencia text := btrim(coalesce(p_payload->>'domicilio_referencia', ''));
  v_movilidad numeric(12,2) := coalesce((p_payload->>'costo_movilidad')::numeric, 0);
  v_cliente text := btrim(coalesce(p_payload->>'cliente', ''));
  v_whatsapp text := btrim(coalesce(p_payload->>'whatsapp_e164', ''));
  v_pais text := upper(btrim(coalesce(p_payload->>'pais_telefono', '')));
  v_servicios jsonb := coalesce(p_payload->'servicios', '[]'::jsonb);
  v_total numeric(12,2) := coalesce((p_payload->>'monto_total')::numeric, 0);
  v_pagado numeric(12,2) := coalesce((p_payload->>'monto_pagado')::numeric, 0);
  v_es_gift boolean := coalesce((p_payload->>'es_gift_card')::boolean, false);
  v_requiere_confirmacion boolean;
  v_adelanto_requerido numeric(12,2);
  v_duracion int;
  v_apertura time;
  v_cierre time;
  v_cliente_id text;
  v_servicio_resumen text;
  v_token text := btrim(coalesce(p_payload->>'token', ''));
  v_token_expira timestamptz := (p_payload->>'token_expira')::timestamptz;
  v_movimiento_id text := btrim(coalesce(p_payload->>'movimiento_id', ''));
  v_reserva_id text := btrim(coalesce(p_payload->>'reserva_id', ''));
  v_pago_id text := btrim(coalesce(p_payload->>'pago_id', ''));
  v_item jsonb;
  v_n int := 0;
  v_solo_domicilio boolean;
  v_hay_domicilio boolean;
  v_total_servicios_domicilio numeric(12,2);
begin
  if v_canal not in ('directo', 'cuponidad', 'bee') then
    raise exception using errcode = '22023', message = 'Canal de origen inválido.';
  end if;
  if v_personas not in (1, 2) then
    raise exception using errcode = '22023', message = 'La cantidad de personas debe ser 1 o 2.';
  end if;
  if v_tipo_atencion not in ('sede', 'domicilio') then
    raise exception using errcode = '22023', message = 'El tipo de atención es inválido.';
  end if;
  if v_cliente = '' then
    raise exception using errcode = '22023', message = 'Falta el nombre del cliente.';
  end if;
  if v_whatsapp !~ '^\+[1-9][0-9]{7,14}$' or v_pais !~ '^[A-Z]{2}$' then
    raise exception using errcode = '22023', message = 'El teléfono normalizado es inválido.';
  end if;
  if jsonb_typeof(v_servicios) <> 'array' or jsonb_array_length(v_servicios) <> v_personas then
    raise exception using errcode = '22023', message = 'Debe existir un servicio validado por persona.';
  end if;
  if v_total <= 0 or v_pagado < 0 then
    raise exception using errcode = '22023', message = 'El total debe ser positivo y el pago no puede ser negativo.';
  end if;
  if v_canal <> 'directo' and (v_es_gift or btrim(coalesce(p_payload->>'cupon_promocional', '')) <> '') then
    raise exception using errcode = '22023', message = 'Gift card y promoción común solo aplican al canal directo.';
  end if;
  if v_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception using errcode = '22023', message = 'El token no cumple el formato seguro.';
  end if;
  if v_movimiento_id = '' or v_reserva_id = '' or v_pago_id = '' then
    raise exception using errcode = '22023', message = 'Faltan identificadores de la operación.';
  end if;

  v_sede := v_sede_operativa;
  select s.hora_apertura, s.hora_cierre into v_apertura, v_cierre
  from public.sedes s
  where s.nombre = v_sede and s.activo is true;
  if not found or v_apertura is null or v_cierre is null then
    raise exception using errcode = '22023', message = 'La sede operativa no existe o no tiene horario configurado.';
  end if;

  select
    bool_and(btrim(x->>'codigo') in ('DOM-1H', 'DOM-2H')),
    bool_or(btrim(x->>'codigo') in ('DOM-1H', 'DOM-2H')),
    sum(case btrim(x->>'codigo') when 'DOM-1H' then 120 when 'DOM-2H' then 230 else 0 end)
  into v_solo_domicilio, v_hay_domicilio, v_total_servicios_domicilio
  from jsonb_array_elements(v_servicios) as items(x);

  if v_tipo_atencion = 'domicilio' then
    if v_distrito = '' or v_direccion = '' then
      raise exception using errcode = '22023', message = 'Distrito y dirección son obligatorios para domicilio.';
    end if;
    if v_es_gift or btrim(coalesce(p_payload->>'cupon_promocional', '')) <> '' then
      raise exception using errcode = '22023', message = 'Gift card y promoción común no aplican a domicilio sin una regla específica.';
    end if;
    if not coalesce(v_solo_domicilio, false) then
      raise exception using errcode = '22023', message = 'Domicilio requiere únicamente servicios DOM-1H o DOM-2H.';
    end if;
    if v_movilidad <> 15 then
      raise exception using errcode = '22023', message = 'La movilidad de domicilio debe ser S/15 una sola vez por cita.';
    end if;
    if v_total <> round(v_total_servicios_domicilio + v_movilidad, 2) then
      raise exception using errcode = '22023', message = 'El total de domicilio no coincide con los servicios y la movilidad.';
    end if;
  else
    if coalesce(v_hay_domicilio, false) then
      raise exception using errcode = '22023', message = 'No se pueden mezclar servicios presenciales y domicilio.';
    end if;
    if v_movilidad <> 0 then
      raise exception using errcode = '22023', message = 'Una cita presencial no puede cobrar movilidad.';
    end if;
    v_distrito := '';
    v_direccion := '';
    v_referencia := '';
  end if;

  select max(coalesce((x->>'duracion_min')::int, 0)),
         string_agg(btrim(x->>'nombre'), ' + ' order by ord)
    into v_duracion, v_servicio_resumen
  from jsonb_array_elements(v_servicios) with ordinality as items(x, ord);
  if coalesce(v_duracion, 0) <= 0 or v_hora < v_apertura
     or v_hora + make_interval(mins => v_duracion) > v_cierre then
    raise exception using errcode = '22023', message = 'La hora o duración queda fuera del horario de la sede.';
  end if;

  v_requiere_confirmacion := v_tipo_atencion = 'domicilio' or v_canal in ('cuponidad', 'bee');
  v_adelanto_requerido := case
    when v_tipo_atencion = 'domicilio' then round(v_total * 0.50, 2)
    when v_canal in ('cuponidad', 'bee') then 0
    when v_es_gift then v_total
    when v_personas = 2 then round(v_total * 0.50, 2)
    else least(10, v_total)
  end;
  if v_pagado < v_adelanto_requerido then
    raise exception using errcode = '22023', message = 'El pago no alcanza el adelanto requerido; no se puede generar el token.';
  end if;
  if v_pagado > 0 and btrim(coalesce(p_payload->>'metodo_pago', '')) = '' then
    raise exception using errcode = '22023', message = 'Falta el método de pago.';
  end if;
  if v_pagado > 0 and upper(btrim(coalesce(p_payload->>'metodo_pago', ''))) <> 'EFECTIVO'
     and btrim(coalesce(p_payload->>'numero_operacion', '')) = '' then
    raise exception using errcode = '22023', message = 'Falta el número de operación para el pago no efectivo.';
  end if;
  if v_token_expira <= (v_fecha + v_hora) at time zone 'America/Lima' then
    raise exception using errcode = '22023', message = 'La expiración debe ser posterior al inicio de la cita.';
  end if;

  select c.cliente_id into v_cliente_id from public.clientes c where c.whatsapp_e164 = v_whatsapp limit 1;
  if v_cliente_id is null then
    v_cliente_id := btrim(coalesce(p_payload->>'cliente_id', ''));
    if v_cliente_id = '' then raise exception using errcode = '22023', message = 'Falta el identificador del cliente.'; end if;
    insert into public.clientes (cliente_id, cliente, whatsapp, whatsapp_e164, pais_telefono, ultima_sede, ultimo_servicio, origen, updated_at)
    values (v_cliente_id, v_cliente, v_whatsapp, v_whatsapp, v_pais, v_sede, v_servicio_resumen, 'APP_CAJA_FICHA', now());
  else
    update public.clientes set cliente = v_cliente, whatsapp = v_whatsapp, whatsapp_e164 = v_whatsapp,
      pais_telefono = v_pais, ultima_sede = v_sede, ultimo_servicio = v_servicio_resumen, updated_at = now()
    where cliente_id = v_cliente_id;
  end if;

  insert into public.caja_movimientos (
    movimiento_id, fecha, hora, sede, tipo_movimiento, estado, cliente_id, cliente, whatsapp, n_pax, servicio, duracion,
    monto_servicio, adelanto_prev, metodo_adelanto_prev, total_cobrar, total_pagado, total_extras, pendiente, responsable, source_type, source_id, observacion
  ) values (
    v_movimiento_id, v_fecha, v_hora, v_sede, 'RESERVA_APP', 'Reservado', v_cliente_id, v_cliente, v_whatsapp, v_personas, v_servicio_resumen,
    v_duracion || ' min', v_total, v_pagado, nullif(btrim(p_payload->>'metodo_pago'), ''), v_total, v_pagado, 0,
    greatest(v_total - v_pagado, 0), nullif(btrim(p_payload->>'responsable'), ''), 'APP_CAJA_FICHA', v_reserva_id,
    nullif(btrim(p_payload->>'observacion'), '')
  );

  insert into public.citas_reservadas (
    reserva_id, fecha_cita, hora_cita, sede, cliente_id, cliente, whatsapp, n_pax, personas, servicio, duracion, duracion_min,
    monto_total, adelanto, metodo_adelanto, saldo_pendiente, estado, source, source_id, estado_ficha, canal, requiere_confirmacion,
    idioma, token_ficha, token_expira, es_gift_card, cupon_promocional, servicios_json, observacion,
    tipo_atencion, sede_operativa, domicilio_distrito, domicilio_direccion, domicilio_referencia, costo_movilidad
  ) values (
    v_reserva_id, v_fecha, v_hora, v_sede, v_cliente_id, v_cliente, v_whatsapp, v_personas, v_personas, v_servicio_resumen,
    v_duracion || ' min', v_duracion, v_total, v_pagado, nullif(btrim(p_payload->>'metodo_pago'), ''), greatest(v_total - v_pagado, 0),
    'PENDIENTE', 'APP_CAJA_FICHA', v_movimiento_id, 'pendiente', v_canal, v_requiere_confirmacion,
    coalesce(nullif(btrim(p_payload->>'idioma'), ''), 'es'), v_token, v_token_expira, v_es_gift,
    nullif(btrim(p_payload->>'cupon_promocional'), ''), v_servicios, nullif(btrim(p_payload->>'observacion'), ''),
    v_tipo_atencion, v_sede, nullif(v_distrito, ''), nullif(v_direccion, ''), nullif(v_referencia, ''), v_movilidad
  );

  insert into public.caja_pagos (
    pago_id, movimiento_id, fecha, hora, sede, tipo_pago, metodo, metodo_detalle, monto, concepto, numero_operacion
  ) values (
    v_pago_id, v_movimiento_id, v_fecha, v_hora, v_sede,
    case when v_requiere_confirmacion and v_canal in ('cuponidad', 'bee') then 'CONVENIO_APP' else 'ADELANTO_APP' end,
    case when v_canal = 'cuponidad' then 'CUPONIDAD' when v_canal = 'bee' then 'BEE_BENEFICIOS' else btrim(p_payload->>'metodo_pago') end,
    null, v_pagado, v_servicio_resumen, nullif(btrim(p_payload->>'numero_operacion'), '')
  );

  for v_item in select value from jsonb_array_elements(v_servicios)
  loop
    v_n := v_n + 1;
    insert into public.caja_atencion_detalle (
      detalle_id, movimiento_id, fecha, sede, persona_n, terapista, servicio, duracion, monto_asignado, observacion
    ) values (
      v_reserva_id || '-P' || v_n, v_movimiento_id, v_fecha, v_sede, v_n, 'Por asignar', btrim(v_item->>'nombre'),
      coalesce((v_item->>'duracion_min')::int, 0) || ' min', coalesce((v_item->>'precio')::numeric, 0),
      nullif(btrim(p_payload->>'observacion'), '')
    );
  end loop;

  return jsonb_build_object('ok', true, 'reserva_id', v_reserva_id, 'movimiento_id', v_movimiento_id,
    'token', v_token, 'adelanto_requerido', v_adelanto_requerido, 'requiere_confirmacion', v_requiere_confirmacion);
end;
$$;

revoke all on function public.preparar_ficha_cita(jsonb) from public;
revoke all on function public.preparar_ficha_cita(jsonb) from anon;
revoke all on function public.preparar_ficha_cita(jsonb) from authenticated;
grant execute on function public.preparar_ficha_cita(jsonb) to service_role;

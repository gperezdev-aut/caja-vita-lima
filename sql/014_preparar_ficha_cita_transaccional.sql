-- ============================================================
-- Caja Vita Lima — Supabase SQL v14
-- Pantalla interna de preparación de ficha de cita.
--
-- IMPORTANTE: esta migración NO ha sido ejecutada en Supabase.
-- Ejecutar 013 antes de 014. No modifica ni reemplaza la 013.
-- ============================================================

alter table public.citas_reservadas
  add column if not exists es_gift_card boolean default false,
  add column if not exists cupon_promocional text,
  add column if not exists servicios_json jsonb default '[]'::jsonb;

-- Toda la operación se ejecuta dentro de una única transacción PostgreSQL.
-- PostgREST invoca la función con la service role; ningún cliente público
-- recibe permisos directos sobre ella.
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
  v_sede text := btrim(coalesce(p_payload->>'sede', ''));
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
begin
  if v_canal not in ('directo', 'cuponidad', 'bee') then
    raise exception using errcode = '22023', message = 'Canal de origen inválido.';
  end if;
  if v_personas not in (1, 2) then
    raise exception using errcode = '22023', message = 'La cantidad de personas debe ser 1 o 2.';
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
  if v_canal <> 'directo' and (
    v_es_gift or btrim(coalesce(p_payload->>'cupon_promocional', '')) <> ''
  ) then
    raise exception using errcode = '22023', message = 'Gift card y promoción común solo aplican al canal directo.';
  end if;
  if v_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception using errcode = '22023', message = 'El token no cumple el formato seguro.';
  end if;
  if v_movimiento_id = '' or v_reserva_id = '' or v_pago_id = '' then
    raise exception using errcode = '22023', message = 'Faltan identificadores de la operación.';
  end if;

  select s.hora_apertura, s.hora_cierre
    into v_apertura, v_cierre
  from public.sedes s
  where s.nombre = v_sede and s.activo is true;

  if not found or v_apertura is null or v_cierre is null then
    raise exception using errcode = '22023', message = 'La sede no existe o no tiene horario configurado.';
  end if;

  select max(coalesce((x->>'duracion_min')::int, 0)),
         string_agg(btrim(x->>'nombre'), ' + ' order by ord)
    into v_duracion, v_servicio_resumen
  from jsonb_array_elements(v_servicios) with ordinality as items(x, ord);

  if coalesce(v_duracion, 0) <= 0 or v_hora < v_apertura
     or v_hora + make_interval(mins => v_duracion) > v_cierre then
    raise exception using errcode = '22023', message = 'La hora o duración queda fuera del horario de la sede.';
  end if;

  v_requiere_confirmacion := v_canal in ('cuponidad', 'bee');
  v_adelanto_requerido := case
    when v_requiere_confirmacion then 0
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
  if v_pagado > 0
     and upper(btrim(coalesce(p_payload->>'metodo_pago', ''))) <> 'EFECTIVO'
     and btrim(coalesce(p_payload->>'numero_operacion', '')) = '' then
    raise exception using errcode = '22023', message = 'Falta el número de operación para el pago no efectivo.';
  end if;
  if v_token_expira <= (v_fecha + v_hora) at time zone 'America/Lima' then
    raise exception using errcode = '22023', message = 'La expiración debe ser posterior al inicio de la cita.';
  end if;

  select c.cliente_id into v_cliente_id
  from public.clientes c
  where c.whatsapp_e164 = v_whatsapp
  limit 1;

  if v_cliente_id is null then
    v_cliente_id := btrim(coalesce(p_payload->>'cliente_id', ''));
    if v_cliente_id = '' then
      raise exception using errcode = '22023', message = 'Falta el identificador del cliente.';
    end if;
    insert into public.clientes (
      cliente_id, cliente, whatsapp, whatsapp_e164, pais_telefono,
      ultima_sede, ultimo_servicio, origen, updated_at
    ) values (
      v_cliente_id, v_cliente, v_whatsapp, v_whatsapp, v_pais,
      v_sede, v_servicio_resumen, 'APP_CAJA_FICHA', now()
    );
  else
    update public.clientes set
      cliente = v_cliente,
      whatsapp = v_whatsapp,
      whatsapp_e164 = v_whatsapp,
      pais_telefono = v_pais,
      ultima_sede = v_sede,
      ultimo_servicio = v_servicio_resumen,
      updated_at = now()
    where cliente_id = v_cliente_id;
  end if;

  insert into public.caja_movimientos (
    movimiento_id, fecha, hora, sede, tipo_movimiento, estado,
    cliente_id, cliente, whatsapp, n_pax, servicio, duracion,
    monto_servicio, adelanto_prev, metodo_adelanto_prev, total_cobrar,
    total_pagado, total_extras, pendiente, responsable, source_type,
    source_id, observacion
  ) values (
    v_movimiento_id, v_fecha, v_hora, v_sede, 'RESERVA_APP', 'Reservado',
    v_cliente_id, v_cliente, v_whatsapp, v_personas, v_servicio_resumen,
    v_duracion || ' min', v_total, v_pagado,
    nullif(btrim(p_payload->>'metodo_pago'), ''), v_total, v_pagado, 0,
    greatest(v_total - v_pagado, 0), nullif(btrim(p_payload->>'responsable'), ''),
    'APP_CAJA_FICHA', v_reserva_id, nullif(btrim(p_payload->>'observacion'), '')
  );

  insert into public.citas_reservadas (
    reserva_id, fecha_cita, hora_cita, sede, cliente_id, cliente, whatsapp,
    n_pax, personas, servicio, duracion, duracion_min, monto_total, adelanto,
    metodo_adelanto, saldo_pendiente, estado, source, source_id,
    estado_ficha, canal, requiere_confirmacion, idioma, token_ficha,
    token_expira, es_gift_card, cupon_promocional, servicios_json, observacion
  ) values (
    v_reserva_id, v_fecha, v_hora, v_sede, v_cliente_id, v_cliente, v_whatsapp,
    v_personas, v_personas, v_servicio_resumen, v_duracion || ' min', v_duracion,
    v_total, v_pagado, nullif(btrim(p_payload->>'metodo_pago'), ''),
    greatest(v_total - v_pagado, 0), 'PENDIENTE', 'APP_CAJA_FICHA',
    v_movimiento_id, 'pendiente', v_canal, v_requiere_confirmacion,
    coalesce(nullif(btrim(p_payload->>'idioma'), ''), 'es'), v_token,
    v_token_expira, v_es_gift, nullif(btrim(p_payload->>'cupon_promocional'), ''),
    v_servicios, nullif(btrim(p_payload->>'observacion'), '')
  );

  -- También se registra una fila de trazabilidad para convenios con monto
  -- cero. Así token y constancia de pago/convenio siguen siendo atómicos.
  insert into public.caja_pagos (
    pago_id, movimiento_id, fecha, hora, sede, tipo_pago, metodo,
    metodo_detalle, monto, concepto, numero_operacion
  ) values (
    v_pago_id, v_movimiento_id, v_fecha, v_hora, v_sede,
    case when v_requiere_confirmacion then 'CONVENIO_APP' else 'ADELANTO_APP' end,
    case
      when v_canal = 'cuponidad' then 'CUPONIDAD'
      when v_canal = 'bee' then 'BEE_BENEFICIOS'
      else btrim(p_payload->>'metodo_pago')
    end,
    null, v_pagado, v_servicio_resumen,
    nullif(btrim(p_payload->>'numero_operacion'), '')
  );

  for v_item in select value from jsonb_array_elements(v_servicios)
  loop
    v_n := v_n + 1;
    insert into public.caja_atencion_detalle (
      detalle_id, movimiento_id, fecha, sede, persona_n, terapista,
      servicio, duracion, monto_asignado, observacion
    ) values (
      v_reserva_id || '-P' || v_n, v_movimiento_id, v_fecha, v_sede, v_n,
      'Por asignar', btrim(v_item->>'nombre'),
      coalesce((v_item->>'duracion_min')::int, 0) || ' min',
      coalesce((v_item->>'precio')::numeric, 0),
      nullif(btrim(p_payload->>'observacion'), '')
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'reserva_id', v_reserva_id,
    'movimiento_id', v_movimiento_id,
    'token', v_token,
    'adelanto_requerido', v_adelanto_requerido,
    'requiere_confirmacion', v_requiere_confirmacion
  );
end;
$$;

revoke all on function public.preparar_ficha_cita(jsonb) from public;
revoke all on function public.preparar_ficha_cita(jsonb) from anon;
revoke all on function public.preparar_ficha_cita(jsonb) from authenticated;
grant execute on function public.preparar_ficha_cita(jsonb) to service_role;

create or replace function public.completar_ficha_cita(
  p_token text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cita public.citas_reservadas%rowtype;
  v_cliente_id text;
  v_whatsapp text := btrim(coalesce(p_payload->>'whatsapp_e164', ''));
  v_nombre text := btrim(coalesce(p_payload->>'nombre', ''));
  v_ahora timestamptz := now();
  v_salud jsonb := coalesce(p_payload->'salud', '{}'::jsonb);
  v_codigo_cupon text := btrim(coalesce(p_payload->>'codigo_cupon', ''));
begin
  select * into v_cita
  from public.citas_reservadas
  where token_ficha = p_token
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'TOKEN_NO_EXISTE';
  end if;
  if v_cita.token_expira is not null and v_cita.token_expira <= v_ahora then
    raise exception using errcode = '22023', message = 'TOKEN_VENCIDO';
  end if;
  if v_cita.estado_ficha = 'completa' then
    raise exception using errcode = '22023', message = 'FICHA_YA_COMPLETA';
  end if;
  if v_nombre = '' or v_whatsapp !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception using errcode = '22023', message = 'DATOS_CLIENTE_INVALIDOS';
  end if;
  if v_cita.canal in ('cuponidad', 'bee') and v_codigo_cupon = '' then
    raise exception using errcode = '22023', message = 'FALTA_CODIGO_CONVENIO';
  end if;

  select cliente_id into v_cliente_id
  from public.clientes
  where whatsapp_e164 = v_whatsapp
  limit 1;
  v_cliente_id := coalesce(v_cliente_id, v_cita.cliente_id, btrim(p_payload->>'cliente_id'));

  insert into public.clientes (
    cliente_id, cliente, email, dni, whatsapp, whatsapp_e164, pais_telefono,
    idioma, cumple_dia, cumple_mes, consent_datos_en, consent_promos_en,
    updated_at
  ) values (
    v_cliente_id, v_nombre, nullif(btrim(p_payload->>'correo'), ''),
    nullif(btrim(p_payload->>'dni'), ''), v_whatsapp, v_whatsapp,
    upper(btrim(p_payload->>'pais_telefono')),
    coalesce(nullif(btrim(p_payload->>'idioma'), ''), 'es'),
    nullif(p_payload->>'cumple_dia', '')::smallint,
    nullif(p_payload->>'cumple_mes', '')::smallint,
    v_ahora,
    case when coalesce((p_payload->>'consent_promos')::boolean, false) then v_ahora else null end,
    v_ahora
  )
  on conflict (cliente_id) do update set
    cliente = excluded.cliente,
    email = excluded.email,
    dni = excluded.dni,
    whatsapp = excluded.whatsapp,
    whatsapp_e164 = excluded.whatsapp_e164,
    pais_telefono = excluded.pais_telefono,
    idioma = excluded.idioma,
    cumple_dia = excluded.cumple_dia,
    cumple_mes = excluded.cumple_mes,
    consent_datos_en = excluded.consent_datos_en,
    consent_promos_en = excluded.consent_promos_en,
    updated_at = excluded.updated_at;

  if coalesce((p_payload->>'guardar_salud')::boolean, false) then
    insert into public.fichas_salud (
      ficha_id, reserva_id, cliente_id, embarazo, presion, cirugia_reciente,
      alergias, zonas_evitar, notas, consent_salud_en
    ) values (
      btrim(p_payload->>'ficha_id'), v_cita.reserva_id, v_cliente_id,
      coalesce((v_salud->>'embarazo')::boolean, false),
      coalesce((v_salud->>'presion')::boolean, false),
      coalesce((v_salud->>'cirugia_reciente')::boolean, false),
      nullif(btrim(v_salud->>'alergias'), ''),
      nullif(btrim(v_salud->>'zonas_evitar'), ''),
      nullif(btrim(v_salud->>'notas'), ''), v_ahora
    )
    on conflict (reserva_id) do update set
      cliente_id = excluded.cliente_id,
      embarazo = excluded.embarazo,
      presion = excluded.presion,
      cirugia_reciente = excluded.cirugia_reciente,
      alergias = excluded.alergias,
      zonas_evitar = excluded.zonas_evitar,
      notas = excluded.notas,
      consent_salud_en = excluded.consent_salud_en;
  end if;

  if v_codigo_cupon <> '' then
    insert into public.cupones_convenios (
      registro_id, fecha, sede, plataforma, codigo_cupon, cliente,
      whatsapp, n_pax, servicio, estado, reserva_id
    ) values (
      btrim(p_payload->>'cupon_id'), v_cita.fecha_cita, v_cita.sede,
      case v_cita.canal when 'cuponidad' then 'Cuponidad' when 'bee' then 'Bee Beneficios' else v_cita.canal end,
      v_codigo_cupon, v_nombre, v_whatsapp,
      coalesce(v_cita.personas, v_cita.n_pax, 1), v_cita.servicio,
      'declarado', v_cita.reserva_id
    );
  end if;

  update public.citas_reservadas set
    cliente_id = v_cliente_id,
    cliente = v_nombre,
    dni = nullif(btrim(p_payload->>'dni'), ''),
    whatsapp = v_whatsapp,
    estado_ficha = 'completa',
    updated_at = v_ahora
  where reserva_id = v_cita.reserva_id;

  return jsonb_build_object('ok', true, 'cliente_id', v_cliente_id);
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'CUPON_YA_USADO';
end;
$$;

revoke all on function public.completar_ficha_cita(text, jsonb) from public;
revoke all on function public.completar_ficha_cita(text, jsonb) from anon;
revoke all on function public.completar_ficha_cita(text, jsonb) from authenticated;
grant execute on function public.completar_ficha_cita(text, jsonb) to service_role;

-- Validación manual posterior (no modifica datos):
-- select proname, prosecdef
-- from pg_proc
-- where proname = 'preparar_ficha_cita';

-- Caja Vita Lima — WhatsApp preconfirmado en convenios
-- Migración 043
--
-- Hotfix posterior a 042:
-- - Preparar cita exige y normaliza WhatsApp.
-- - La reserva guarda el E.164 sin crear todavía un cliente.
-- - La ficha pública puede omitir la re-digitación del WhatsApp.
-- - No crea caja_pagos ni cambia la lógica de cobertura/canje.

begin;

create or replace function public.preparar_ficha_convenio_v1(p_payload jsonb)
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
  v_fecha date := (p_payload->>'fecha')::date;
  v_hora time := (p_payload->>'hora')::time;
  v_sede text := btrim(coalesce(p_payload->>'sede', ''));
  v_whatsapp text := btrim(coalesce(p_payload->>'whatsapp_e164', ''));
  v_responsable text := nullif(btrim(coalesce(p_payload->>'responsable', '')), '');
  v_movimiento_id text := btrim(coalesce(p_payload->>'movimiento_id', ''));
  v_reserva_id text := btrim(coalesce(p_payload->>'reserva_id', ''));
  v_token text := btrim(coalesce(p_payload->>'token', ''));
  v_token_expira timestamptz := (p_payload->>'token_expira')::timestamptz;
  v_apertura time;
  v_cierre time;
  v_proveedor text;
begin
  begin
    v_request_id := (p_payload->>'request_id')::uuid;
  exception when others then
    raise exception using errcode='22023', message='REQUEST_ID_INVALIDO';
  end;

  v_fingerprint := md5((p_payload
    - 'request_id'
    - 'movimiento_id'
    - 'reserva_id'
    - 'token')::text);

  select *
  into v_existente
  from public.citas_reservadas
  where request_id = v_request_id
  for update;

  if found then
    if v_existente.request_fingerprint is distinct from v_fingerprint then
      raise exception using errcode='23505', message='REQUEST_ID_PAYLOAD_CONFLICTO';
    end if;
    return jsonb_build_object(
      'ok', true,
      'reutilizado', true,
      'reserva_id', v_existente.reserva_id,
      'movimiento_id', v_existente.source_id,
      'token', v_existente.token_ficha
    );
  end if;

  if v_canal not in ('cuponidad', 'bee') then
    raise exception using errcode='22023', message='CONVENIO_PROVEEDOR_INVALIDO';
  end if;
  if v_whatsapp !~ '^\+[1-9][0-9]{7,14}
    raise exception using errcode='22023', message='FECHA_CITA_INVALIDA';
  end if;
  if v_hora is null or v_sede = '' then
    raise exception using errcode='22023', message='AGENDA_CONVENIO_INCOMPLETA';
  end if;

  select hora_apertura, hora_cierre
  into v_apertura, v_cierre
  from public.sedes
  where nombre = v_sede and activo is true;

  if not found or v_apertura is null or v_cierre is null then
    raise exception using errcode='22023', message='SEDE_OPERATIVA_INVALIDA';
  end if;

  -- Aún no conocemos el servicio. Solo validamos que el inicio y un bloque
  -- mínimo de 30 minutos estén dentro del horario. La duración real se
  -- valida al asignar el servicio desde /cupones.
  if v_hora < v_apertura or v_hora + interval '30 minutes' > v_cierre then
    raise exception using errcode='22023', message='HORARIO_FUERA_DE_SEDE';
  end if;

  if v_token !~ '^[A-Za-z0-9_-]{43}$'
     or v_token_expira is null
     or v_token_expira <= now() then
    raise exception using errcode='22023', message='TOKEN_O_EXPIRACION_INVALIDOS';
  end if;
  if v_movimiento_id = '' or v_reserva_id = '' then
    raise exception using errcode='22023', message='IDENTIFICADORES_OPERACION_REQUERIDOS';
  end if;

  v_proveedor := case v_canal when 'cuponidad' then 'Cuponidad' else 'Bee Beneficios' end;

  insert into public.caja_movimientos (
    movimiento_id, fecha, hora, sede, tipo_movimiento, estado,
    cliente_id, cliente, whatsapp, n_pax, servicio, duracion,
    monto_servicio, adelanto_prev, metodo_adelanto_prev,
    total_cobrar, total_pagado, total_extras, pendiente,
    estado_boleta, numero_boleta, responsable, source_type, source_id,
    observacion
  ) values (
    v_movimiento_id, v_fecha, v_hora, v_sede, 'RESERVA_APP', 'Esperando ficha',
    null, 'Cliente pendiente', v_whatsapp, 1,
    v_proveedor || ' · beneficio por validar', 'Por definir',
    0, 0, null,
    0, 0, 0, 0,
    'No aplica', null, v_responsable, 'APP_CAJA_CONVENIO', v_reserva_id,
    'Reserva preliminar de convenio. WhatsApp confirmado en Caja; nombre, código y servicio se completan después.'
  );

  insert into public.citas_reservadas (
    reserva_id, fecha_cita, hora_cita, sede,
    cliente_id, cliente, whatsapp, n_pax, personas,
    servicio, duracion, duracion_min,
    monto_total, adelanto, metodo_adelanto, saldo_pendiente,
    estado, source, source_id, estado_ficha, canal,
    requiere_confirmacion, confirmado_en, idioma,
    token_ficha, token_expira, es_gift_card, cupon_promocional,
    servicios_json, observacion, tipo_atencion, sede_operativa,
    costo_movilidad, request_id, request_fingerprint
  ) values (
    v_reserva_id, v_fecha, v_hora, v_sede,
    null, null, v_whatsapp, 1, 1,
    v_proveedor || ' · beneficio por validar', 'Por definir', null,
    0, 0, null, 0,
    'PENDIENTE', 'APP_CAJA_CONVENIO', v_movimiento_id, 'pendiente', v_canal,
    true, null, 'es',
    v_token, v_token_expira, false, null,
    '[]'::jsonb, 'Reserva preliminar de convenio; servicio pendiente de validar.',
    'sede', v_sede, 0, v_request_id, v_fingerprint
  );

  -- Deliberadamente NO se inserta ninguna fila en public.caja_pagos.

  return jsonb_build_object(
    'ok', true,
    'reutilizado', false,
    'reserva_id', v_reserva_id,
    'movimiento_id', v_movimiento_id,
    'token', v_token
  );
exception
  when unique_violation then
    if exists (select 1 from public.citas_reservadas where request_id = v_request_id) then
      select * into v_existente
      from public.citas_reservadas
      where request_id = v_request_id;

      if v_existente.request_fingerprint = v_fingerprint then
        return jsonb_build_object(
          'ok', true,
          'reutilizado', true,
          'reserva_id', v_existente.reserva_id,
          'movimiento_id', v_existente.source_id,
          'token', v_existente.token_ficha
        );
      end if;
      raise exception using errcode='23505', message='REQUEST_ID_PAYLOAD_CONFLICTO';
    end if;
    raise;
end;
$$;

 then
    raise exception using errcode='22023', message='WHATSAPP_CONVENIO_INVALIDO';
  end if;
  if v_fecha is null or v_fecha < (now() at time zone 'America/Lima')::date then
    raise exception using errcode='22023', message='FECHA_CITA_INVALIDA';
  end if;
  if v_hora is null or v_sede = '' then
    raise exception using errcode='22023', message='AGENDA_CONVENIO_INCOMPLETA';
  end if;

  select hora_apertura, hora_cierre
  into v_apertura, v_cierre
  from public.sedes
  where nombre = v_sede and activo is true;

  if not found or v_apertura is null or v_cierre is null then
    raise exception using errcode='22023', message='SEDE_OPERATIVA_INVALIDA';
  end if;

  -- Aún no conocemos el servicio. Solo validamos que el inicio y un bloque
  -- mínimo de 30 minutos estén dentro del horario. La duración real se
  -- valida al asignar el servicio desde /cupones.
  if v_hora < v_apertura or v_hora + interval '30 minutes' > v_cierre then
    raise exception using errcode='22023', message='HORARIO_FUERA_DE_SEDE';
  end if;

  if v_token !~ '^[A-Za-z0-9_-]{43}$'
     or v_token_expira is null
     or v_token_expira <= now() then
    raise exception using errcode='22023', message='TOKEN_O_EXPIRACION_INVALIDOS';
  end if;
  if v_movimiento_id = '' or v_reserva_id = '' then
    raise exception using errcode='22023', message='IDENTIFICADORES_OPERACION_REQUERIDOS';
  end if;

  v_proveedor := case v_canal when 'cuponidad' then 'Cuponidad' else 'Bee Beneficios' end;

  insert into public.caja_movimientos (
    movimiento_id, fecha, hora, sede, tipo_movimiento, estado,
    cliente_id, cliente, whatsapp, n_pax, servicio, duracion,
    monto_servicio, adelanto_prev, metodo_adelanto_prev,
    total_cobrar, total_pagado, total_extras, pendiente,
    estado_boleta, numero_boleta, responsable, source_type, source_id,
    observacion
  ) values (
    v_movimiento_id, v_fecha, v_hora, v_sede, 'RESERVA_APP', 'Esperando ficha',
    null, 'Cliente pendiente', null, 1,
    v_proveedor || ' · beneficio por validar', 'Por definir',
    0, 0, null,
    0, 0, 0, 0,
    'No aplica', null, v_responsable, 'APP_CAJA_CONVENIO', v_reserva_id,
    'Reserva preliminar de convenio. Datos, código y servicio se completan después.'
  );

  insert into public.citas_reservadas (
    reserva_id, fecha_cita, hora_cita, sede,
    cliente_id, cliente, whatsapp, n_pax, personas,
    servicio, duracion, duracion_min,
    monto_total, adelanto, metodo_adelanto, saldo_pendiente,
    estado, source, source_id, estado_ficha, canal,
    requiere_confirmacion, confirmado_en, idioma,
    token_ficha, token_expira, es_gift_card, cupon_promocional,
    servicios_json, observacion, tipo_atencion, sede_operativa,
    costo_movilidad, request_id, request_fingerprint
  ) values (
    v_reserva_id, v_fecha, v_hora, v_sede,
    null, null, null, 1, 1,
    v_proveedor || ' · beneficio por validar', 'Por definir', null,
    0, 0, null, 0,
    'PENDIENTE', 'APP_CAJA_CONVENIO', v_movimiento_id, 'pendiente', v_canal,
    true, null, 'es',
    v_token, v_token_expira, false, null,
    '[]'::jsonb, 'Reserva preliminar de convenio; servicio pendiente de validar.',
    'sede', v_sede, 0, v_request_id, v_fingerprint
  );

  -- Deliberadamente NO se inserta ninguna fila en public.caja_pagos.

  return jsonb_build_object(
    'ok', true,
    'reutilizado', false,
    'reserva_id', v_reserva_id,
    'movimiento_id', v_movimiento_id,
    'token', v_token
  );
exception
  when unique_violation then
    if exists (select 1 from public.citas_reservadas where request_id = v_request_id) then
      select * into v_existente
      from public.citas_reservadas
      where request_id = v_request_id;

      if v_existente.request_fingerprint = v_fingerprint then
        return jsonb_build_object(
          'ok', true,
          'reutilizado', true,
          'reserva_id', v_existente.reserva_id,
          'movimiento_id', v_existente.source_id,
          'token', v_existente.token_ficha
        );
      end if;
      raise exception using errcode='23505', message='REQUEST_ID_PAYLOAD_CONFLICTO';
    end if;
    raise;
end;
$$;


revoke all on function public.preparar_ficha_convenio_v1(jsonb)
from public, anon, authenticated;

grant execute on function public.preparar_ficha_convenio_v1(jsonb) to service_role;

comment on function public.preparar_ficha_convenio_v1(jsonb) is
  'Crea reserva preliminar Cuponidad/Bee con WhatsApp confirmado en Caja, sin servicio ni pago; el cliente completa nombre, código y salud en la ficha web.';

commit;

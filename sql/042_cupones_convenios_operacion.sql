-- Caja Vita Lima — flujo operativo Cuponidad / Bee Beneficios
-- Migración 042. Propuesta para revisión; NO ejecutar automáticamente.
--
-- Principios:
-- 1) Caja agenda proveedor + sede + fecha + hora.
-- 2) El cliente completa datos y código únicamente desde la ficha web.
-- 3) El cupón/convenio NO crea caja_pagos ni se trata como dinero recibido.
-- 4) Vita Operación valida servicio y monto reconocido antes de atender.
-- 5) El canje real ocurre al aplicar la cobertura de convenio en Conciliación V2.

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
    false, null, 'es',
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

create or replace function public.caja_sync_estado_convenio_cita_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if nullif(btrim(coalesce(new.reserva_id, '')), '') is null then
    return new;
  end if;

  update public.caja_movimientos
  set
    estado = case new.estado
      when 'declarado' then 'Cupón registrado'
      when 'verificado' then 'Cupón verificado'
      when 'canjeado' then 'Cupón canjeado'
      else estado
    end,
    updated_at = now()
  where source_id = new.reserva_id;

  return new;
end;
$$;

drop trigger if exists trg_caja_sync_estado_convenio_cita_v1
on public.cupones_convenios;

create trigger trg_caja_sync_estado_convenio_cita_v1
after insert or update of estado
on public.cupones_convenios
for each row
execute function public.caja_sync_estado_convenio_cita_v1();

create or replace function public.caja_validar_cupon_convenio_v1(
  p_registro_id text,
  p_service_code text,
  p_monto_reconocido numeric,
  p_responsable text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cupon public.cupones_convenios%rowtype;
  v_cita public.citas_reservadas%rowtype;
  v_mov public.caja_movimientos%rowtype;
  v_service record;
  v_apertura time;
  v_cierre time;
  v_personas integer;
  v_persona integer;
  v_asignado numeric(12,2) := 0;
  v_monto_detalle numeric(12,2);
  v_plataforma text;
begin
  if nullif(btrim(coalesce(p_registro_id, '')), '') is null
     or nullif(btrim(coalesce(p_service_code, '')), '') is null
     or coalesce(p_monto_reconocido, 0) <= 0
     or nullif(btrim(coalesce(p_responsable, '')), '') is null then
    raise exception using errcode='22023', message='VALIDACION_CUPON_INCOMPLETA';
  end if;

  select *
  into v_cupon
  from public.cupones_convenios
  where registro_id = p_registro_id
  for update;

  if not found then
    raise exception using errcode='P0002', message='CONVENIO_NO_EXISTE';
  end if;
  if v_cupon.estado = 'canjeado' then
    raise exception using errcode='23514', message='CONVENIO_YA_CANJEADO';
  end if;
  if nullif(btrim(coalesce(v_cupon.reserva_id, '')), '') is null
     or nullif(btrim(coalesce(v_cupon.codigo_cupon, '')), '') is null then
    raise exception using errcode='23514', message='CONVENIO_SIN_RESERVA_O_CODIGO';
  end if;

  select *
  into v_cita
  from public.citas_reservadas
  where reserva_id = v_cupon.reserva_id
  for update;

  if not found then
    raise exception using errcode='P0002', message='RESERVA_NO_EXISTE';
  end if;
  if v_cita.estado_ficha <> 'completa' or v_cita.cliente_id is null then
    raise exception using errcode='23514', message='CUPON_SIN_FICHA_COMPLETA';
  end if;
  if v_cita.canal not in ('cuponidad', 'bee') then
    raise exception using errcode='23514', message='RESERVA_NO_ES_CONVENIO';
  end if;

  v_plataforma := case
    when upper(coalesce(v_cupon.plataforma, '')) like '%CUPONIDAD%' then 'cuponidad'
    when upper(coalesce(v_cupon.plataforma, '')) like '%BEE%' then 'bee'
    else null
  end;
  if v_plataforma is distinct from v_cita.canal then
    raise exception using errcode='23514', message='CONVENIO_PLATAFORMA_NO_COINCIDE';
  end if;

  select *
  into v_service
  from public.caja_catalog_active_services_read_v1()
  where service_code = btrim(p_service_code);

  if not found
     or v_service.reservation_behavior <> 'APPOINTMENT'
     or v_service.category = 'HOME'
     or v_service.modality = 'HOME'
     or coalesce(v_service.duration_min, 0) <= 0 then
    raise exception using errcode='22023', message='SERVICIO_CONVENIO_INVALIDO';
  end if;

  if v_cupon.estado = 'verificado' then
    if v_cita.service_code = v_service.service_code
       and round(coalesce(v_cupon.monto_reconocido, 0), 2) = round(p_monto_reconocido, 2) then
      return jsonb_build_object('ok', true, 'reutilizado', true);
    end if;
    raise exception using errcode='23514', message='CUPON_YA_VERIFICADO';
  end if;
  if v_cupon.estado <> 'declarado' then
    raise exception using errcode='23514', message='ESTADO_CUPON_NO_VALIDABLE';
  end if;

  select *
  into v_mov
  from public.caja_movimientos
  where movimiento_id = v_cita.source_id
  for update;

  if not found or v_mov.source_id is distinct from v_cita.reserva_id then
    raise exception using errcode='23514', message='MOVIMIENTO_RESERVA_NO_COINCIDE';
  end if;

  select hora_apertura, hora_cierre
  into v_apertura, v_cierre
  from public.sedes
  where nombre = v_cita.sede and activo is true;

  if not found
     or v_cita.hora_cita < v_apertura
     or v_cita.hora_cita + make_interval(mins => v_service.duration_min) > v_cierre then
    raise exception using errcode='23514', message='HORARIO_NO_CABE_SERVICIO';
  end if;

  v_personas := case
    when v_service.selection_rule = 'FIXED_TWO_PACKAGE' then 2
    else greatest(1, coalesce(v_service.people_min, 1))
  end;
  if v_personas > 2 then
    raise exception using errcode='22023', message='SERVICIO_CONVENIO_INVALIDO';
  end if;

  update public.cupones_convenios
  set
    servicio = v_service.name_es,
    monto_reconocido = round(p_monto_reconocido, 2),
    monto_cobrado_tienda = coalesce(monto_cobrado_tienda, 0),
    estado = 'verificado',
    responsable = btrim(p_responsable)
  where registro_id = v_cupon.registro_id;

  update public.citas_reservadas
  set
    service_code = v_service.service_code,
    servicio = v_service.name_es,
    duracion = v_service.duration_min || ' min',
    duracion_min = v_service.duration_min,
    n_pax = v_personas,
    personas = v_personas,
    monto_total = round(p_monto_reconocido, 2),
    adelanto = 0,
    metodo_adelanto = null,
    saldo_pendiente = round(p_monto_reconocido, 2),
    servicios_json = jsonb_build_array(jsonb_build_object(
      'codigo', v_service.service_code,
      'nombre', v_service.name_es,
      'duracion_min', v_service.duration_min,
      'precio', v_service.price_pen,
      'release_id', v_service.release_id,
      'price_version', v_service.price_version
    )),
    updated_at = now()
  where reserva_id = v_cita.reserva_id;

  update public.caja_movimientos
  set
    cliente_id = v_cita.cliente_id,
    cliente = v_cita.cliente,
    whatsapp = v_cita.whatsapp,
    n_pax = v_personas,
    servicio = v_service.name_es,
    duracion = v_service.duration_min || ' min',
    monto_servicio = round(p_monto_reconocido, 2),
    adelanto_prev = 0,
    metodo_adelanto_prev = null,
    total_cobrar = round(p_monto_reconocido, 2),
    total_pagado = 0,
    pendiente = round(p_monto_reconocido, 2),
    estado = 'Cupón verificado',
    updated_at = now()
  where movimiento_id = v_mov.movimiento_id;

  delete from public.caja_atencion_detalle
  where movimiento_id = v_mov.movimiento_id;

  for v_persona in 1..v_personas loop
    if v_persona = v_personas then
      v_monto_detalle := round(p_monto_reconocido - v_asignado, 2);
    else
      v_monto_detalle := round(p_monto_reconocido / v_personas, 2);
      v_asignado := v_asignado + v_monto_detalle;
    end if;

    insert into public.caja_atencion_detalle (
      detalle_id, movimiento_id, fecha, sede, persona_n,
      terapista, servicio, duracion, monto_asignado, observacion
    ) values (
      v_cita.reserva_id || '-P' || v_persona,
      v_mov.movimiento_id,
      v_cita.fecha_cita,
      v_cita.sede,
      v_persona,
      'Por asignar',
      v_service.name_es,
      v_service.duration_min || ' min',
      v_monto_detalle,
      'Servicio validado desde módulo Cupones'
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'reutilizado', false,
    'reserva_id', v_cita.reserva_id,
    'movimiento_id', v_mov.movimiento_id,
    'service_code', v_service.service_code,
    'monto_reconocido', round(p_monto_reconocido, 2)
  );
end;
$$;

revoke all on function public.preparar_ficha_convenio_v1(jsonb)
from public, anon, authenticated;
revoke all on function public.caja_sync_estado_convenio_cita_v1()
from public, anon, authenticated;
revoke all on function public.caja_validar_cupon_convenio_v1(text, text, numeric, text)
from public, anon, authenticated;

grant execute on function public.preparar_ficha_convenio_v1(jsonb) to service_role;
grant execute on function public.caja_validar_cupon_convenio_v1(text, text, numeric, text) to service_role;

comment on function public.preparar_ficha_convenio_v1(jsonb) is
  'Crea reserva preliminar Cuponidad/Bee sin cliente, servicio ni pago; el cliente completa la ficha web.';
comment on function public.caja_validar_cupon_convenio_v1(text, text, numeric, text) is
  'Asigna servicio canónico y monto reconocido a un cupón declarado, sin registrar dinero recibido.';

commit;

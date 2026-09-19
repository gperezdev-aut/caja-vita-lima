-- QA aislado para sql/042_cupones_convenios_operacion.sql
-- Debe ejecutarse después de las migraciones base + Conciliación V2.
begin;

do $$
declare
  v_result jsonb;
  v_service_code text;
  v_service_name text;
  v_count int;
begin
  select service_code, name_es
  into v_service_code, v_service_name
  from public.caja_catalog_active_services_read_v1()
  where reservation_behavior = 'APPOINTMENT'
    and selection_rule = 'ONE_PERSON'
    and category <> 'HOME'
    and modality <> 'HOME'
    and duration_min between 1 and 120
  order by service_code
  limit 1;

  if v_service_code is null then
    raise exception 'QA_CONVENIO_SIN_SERVICIO_APTO';
  end if;

  select public.preparar_ficha_convenio_v1(
    jsonb_build_object(
      'request_id', '42000000-0000-4000-8000-000000000001',
      'canal', 'cuponidad',
      'fecha', ((now() at time zone 'America/Lima')::date + 1)::text,
      'hora', '12:00',
      'sede', 'Miraflores',
      'responsable', 'QA',
      'movimiento_id', 'MOV-QA-CUPON-001',
      'reserva_id', 'RES-QA-CUPON-001',
      'token', repeat('A', 43),
      'token_expira', (now() + interval '30 days')::text
    )
  ) into v_result;

  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'QA_CONVENIO_PREPARACION_FALLO';
  end if;

  select count(*) into v_count
  from public.caja_pagos
  where movimiento_id = 'MOV-QA-CUPON-001';
  if v_count <> 0 then
    raise exception 'QA_CONVENIO_CREO_PAGO';
  end if;

  if not exists (
    select 1 from public.caja_movimientos
    where movimiento_id = 'MOV-QA-CUPON-001'
      and estado = 'Esperando ficha'
      and total_pagado = 0
      and total_cobrar = 0
  ) then
    raise exception 'QA_CONVENIO_MOVIMIENTO_PRELIMINAR_INVALIDO';
  end if;

  if not exists (
    select 1 from public.citas_reservadas
    where reserva_id = 'RES-QA-CUPON-001'
      and canal = 'cuponidad'
      and estado_ficha = 'pendiente'
      and requiere_confirmacion is true
      and confirmado_en is null
      and monto_total = 0
      and adelanto = 0
  ) then
    raise exception 'QA_CONVENIO_RESERVA_PRELIMINAR_INVALIDA';
  end if;

  update public.citas_reservadas
  set
    cliente_id = 'CLI-QA-CUPON-001',
    cliente = 'Cliente QA Cupón',
    whatsapp = '+51911111111',
    estado_ficha = 'completa'
  where reserva_id = 'RES-QA-CUPON-001';

  insert into public.cupones_convenios (
    registro_id, fecha, sede, plataforma, codigo_cupon,
    cliente, whatsapp, n_pax, servicio, estado, reserva_id
  ) values (
    'CUP-QA-001',
    (now() at time zone 'America/Lima')::date + 1,
    'Miraflores',
    'Cuponidad',
    'QA-CODIGO-001',
    'Cliente QA Cupón',
    '+51911111111',
    1,
    'Pendiente de validar',
    'declarado',
    'RES-QA-CUPON-001'
  );

  if not exists (
    select 1 from public.caja_movimientos
    where movimiento_id = 'MOV-QA-CUPON-001'
      and estado = 'Cupón registrado'
  ) then
    raise exception 'QA_CONVENIO_ESTADO_DECLARADO_NO_SINCRONIZA';
  end if;

  select public.caja_validar_cupon_convenio_v1(
    'CUP-QA-001',
    v_service_code,
    70.00,
    'QA'
  ) into v_result;

  if coalesce((v_result->>'ok')::boolean, false) is not true
     or coalesce((v_result->>'reutilizado')::boolean, false) is true then
    raise exception 'QA_CONVENIO_VALIDACION_FALLO';
  end if;

  if not exists (
    select 1
    from public.cupones_convenios
    where registro_id = 'CUP-QA-001'
      and estado = 'verificado'
      and servicio = v_service_name
      and monto_reconocido = 70.00
  ) then
    raise exception 'QA_CONVENIO_NO_QUEDA_VERIFICADO';
  end if;

  if not exists (
    select 1
    from public.citas_reservadas
    where reserva_id = 'RES-QA-CUPON-001'
      and service_code = v_service_code
      and monto_total = 70.00
      and adelanto = 0
      and saldo_pendiente = 70.00
      and confirmado_en is not null
  ) then
    raise exception 'QA_CONVENIO_RESERVA_NO_RECIBE_SERVICIO';
  end if;

  if not exists (
    select 1
    from public.caja_movimientos
    where movimiento_id = 'MOV-QA-CUPON-001'
      and estado = 'Cupón verificado'
      and monto_servicio = 70.00
      and total_cobrar = 70.00
      and total_pagado = 0
      and pendiente = 70.00
  ) then
    raise exception 'QA_CONVENIO_MOVIMIENTO_NO_RECIBE_COBERTURA';
  end if;

  select count(*) into v_count
  from public.caja_pagos
  where movimiento_id = 'MOV-QA-CUPON-001';
  if v_count <> 0 then
    raise exception 'QA_CONVENIO_VALIDACION_CREO_PAGO';
  end if;

  select public.caja_validar_cupon_convenio_v1(
    'CUP-QA-001',
    v_service_code,
    70.00,
    'QA'
  ) into v_result;

  if coalesce((v_result->>'reutilizado')::boolean, false) is not true then
    raise exception 'QA_CONVENIO_IDEMPOTENCIA_FALLO';
  end if;

  begin
    perform public.caja_validar_cupon_convenio_v1(
      'CUP-QA-001',
      v_service_code,
      71.00,
      'QA'
    );
    raise exception 'QA_CONVENIO_PERMITIO_CAMBIAR_VERIFICADO';
  exception
    when sqlstate '23514' then
      if sqlerrm <> 'CUPON_YA_VERIFICADO' then
        raise;
      end if;
  end;
end;
$$;

rollback;

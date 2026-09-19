-- QA aislado para sql/043_catalogo_convenios_servicios.sql
begin;

do $$
declare
  v_result jsonb;
  v_count integer;
begin
  select count(*) into v_count
  from public.caja_convenio_beneficios
  where activo is true;

  if v_count <> 7 then
    raise exception 'QA_CATALOGO_CONVENIOS_CANTIDAD_INVALIDA';
  end if;

  if (select count(*) from public.caja_convenio_beneficios where proveedor='cuponidad' and activo is true) <> 4 then
    raise exception 'QA_CATALOGO_CUPONIDAD_INVALIDO';
  end if;

  if (select count(*) from public.caja_convenio_beneficios where proveedor='bee' and activo is true) <> 3 then
    raise exception 'QA_CATALOGO_BEE_INVALIDO';
  end if;

  select public.preparar_ficha_convenio_v1(
    jsonb_build_object(
      'request_id', '43000000-0000-4000-8000-000000000001',
      'canal', 'cuponidad',
      'fecha', ((now() at time zone 'America/Lima')::date + 1)::text,
      'hora', '12:00',
      'sede', 'San Borja',
      'responsable', 'QA',
      'movimiento_id', 'MOV-QA-CATCONV-001',
      'reserva_id', 'RES-QA-CATCONV-001',
      'token', repeat('D', 43),
      'token_expira', (now() + interval '30 days')::text
    )
  ) into v_result;

  update public.citas_reservadas
  set
    cliente_id = 'CLI-QA-CATCONV-001',
    cliente = 'Cliente QA Catálogo',
    whatsapp = '+51922222222',
    estado_ficha = 'completa'
  where reserva_id = 'RES-QA-CATCONV-001';

  insert into public.cupones_convenios (
    registro_id, fecha, sede, plataforma, codigo_cupon,
    cliente, whatsapp, n_pax, servicio, estado, reserva_id
  ) values (
    'CUP-QA-CATCONV-001',
    (now() at time zone 'America/Lima')::date + 1,
    'San Borja',
    'Cuponidad',
    'QA-CATCONV-001',
    'Cliente QA Catálogo',
    '+51922222222',
    1,
    'Cuponidad · beneficio por validar',
    'declarado',
    'RES-QA-CATCONV-001'
  );

  begin
    perform public.caja_asignar_beneficio_convenio_v1(
      'CUP-QA-CATCONV-001',
      'BEE-PACK-VITA',
      'QA'
    );
    raise exception 'QA_PERMITIO_BENEFICIO_OTRO_PROVEEDOR';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'BENEFICIO_CONVENIO_INVALIDO' then
        raise;
      end if;
  end;

  select public.caja_asignar_beneficio_convenio_v1(
    'CUP-QA-CATCONV-001',
    'CUP-MASAJE-3S',
    'QA'
  ) into v_result;

  if coalesce((v_result->>'ok')::boolean,false) is not true
     or (v_result->>'duracion_min')::integer <> 30
     or (v_result->>'sesiones_total')::integer <> 3
     or coalesce((v_result->>'economia_pendiente')::boolean,false) is not true then
    raise exception 'QA_ASIGNACION_BENEFICIO_FALLO';
  end if;

  if not exists (
    select 1
    from public.cupones_convenios
    where registro_id='CUP-QA-CATCONV-001'
      and beneficio_code='CUP-MASAJE-3S'
      and sesiones_total=3
      and servicio='3 sesiones de masaje relajante y descontracturante'
      and estado='declarado'
      and coalesce(monto_reconocido,0)=0
      and coalesce(monto_cobrado_tienda,0)=0
  ) then
    raise exception 'QA_CUPON_NO_GUARDA_BENEFICIO_SIN_ECONOMIA';
  end if;

  if not exists (
    select 1
    from public.citas_reservadas
    where reserva_id='RES-QA-CATCONV-001'
      and service_code is null
      and servicio='3 sesiones de masaje relajante y descontracturante'
      and duracion_min=30
      and n_pax=1
      and personas=1
      and monto_total=0
      and adelanto=0
      and saldo_pendiente=0
      and confirmado_en is null
  ) then
    raise exception 'QA_RESERVA_NO_GUARDA_SERVICIO_SIN_ECONOMIA';
  end if;

  if not exists (
    select 1
    from public.caja_movimientos
    where movimiento_id='MOV-QA-CATCONV-001'
      and servicio='3 sesiones de masaje relajante y descontracturante'
      and duracion='30 min'
      and monto_servicio=0
      and total_cobrar=0
      and total_pagado=0
      and pendiente=0
      and estado='Cupón registrado'
  ) then
    raise exception 'QA_MOVIMIENTO_NO_GUARDA_SERVICIO_SIN_ECONOMIA';
  end if;

  select count(*) into v_count
  from public.caja_pagos
  where movimiento_id='MOV-QA-CATCONV-001';

  if v_count <> 0 then
    raise exception 'QA_ASIGNAR_BENEFICIO_CREO_PAGO';
  end if;
end;
$$;

rollback;

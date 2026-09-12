begin;

do $$
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
  v_hora_cobro time := (now() at time zone 'America/Lima')::time;
  v_fecha_cita date := (now() at time zone 'America/Lima')::date + 8;
  v_servicio text;
  v_payload jsonb;
  v_primero jsonb;
  v_reintento jsonb;
  v_total_dia numeric;
begin
  select service_code into v_servicio
  from public.caja_catalog_active_services_read_v1()
  where selection_rule = 'ONE_PERSON'
    and reservation_behavior = 'APPOINTMENT'
    and price_pen >= 115
  order by price_pen, service_code
  limit 1;

  if v_servicio is null then
    raise exception 'QA_021_SERVICE_AT_LEAST_115_MISSING';
  end if;

  -- Caso A: cita futura, cobro hoy por S/115.
  v_payload := jsonb_build_object(
    'request_id', 'a2100000-0000-4000-8000-000000000001',
    'canal', 'directo',
    'personas', 1,
    'cliente', 'QA LEDGER FUTURO',
    'fecha', v_fecha_cita,
    'hora', '12:00',
    'whatsapp_e164', '+51921000001',
    'pais_telefono', 'PE',
    'tipo_atencion', 'sede',
    'sede', 'Miraflores',
    'sede_operativa', 'Miraflores',
    'servicios', jsonb_build_array(jsonb_build_object('codigo', v_servicio)),
    'monto_pagado', 115,
    'metodo_pago', 'YAPE',
    'numero_operacion', 'QA-021-A',
    'fecha_pago', '2000-01-01',
    'hora_pago', '00:00',
    'cliente_id', 'CLI-QA-021-A',
    'movimiento_id', 'MOV-QA-021-A',
    'reserva_id', 'RES-QA-021-A',
    'pago_id', 'PAY-QA-021-A',
    'token', repeat('A', 43),
    'token_expira', (v_fecha_cita::timestamp + time '18:00') at time zone 'America/Lima'
  );

  v_primero := public.preparar_ficha_cita(v_payload);

  if (select fecha from public.caja_movimientos where movimiento_id = 'MOV-QA-021-A') <> v_fecha_cita
     or (select fecha_cita from public.citas_reservadas where reserva_id = 'RES-QA-021-A') <> v_fecha_cita
     or (select fecha from public.caja_pagos where pago_id = 'PAY-QA-021-A') <> v_hoy
     or (select monto from public.caja_pagos where pago_id = 'PAY-QA-021-A') <> 115 then
    raise exception 'QA_021_CASE_A_DATE_CONTRACT';
  end if;
  if (select hora from public.caja_pagos where pago_id = 'PAY-QA-021-A') <> v_hora_cobro then
    raise exception 'QA_021_CASE_A_REAL_PAYMENT_TIME';
  end if;

  -- Caso C: el mismo request_id y payload reutiliza la reserva y no duplica pago.
  v_reintento := public.preparar_ficha_cita(v_payload);
  if coalesce((v_primero->>'reutilizado')::boolean, false) is true
     or (v_reintento->>'reutilizado')::boolean is not true
     or (select count(*) from public.caja_pagos where movimiento_id = 'MOV-QA-021-A') <> 1 then
    raise exception 'QA_021_CASE_C_IDEMPOTENCY';
  end if;

  -- Caso B: cita y cobro del mismo día siguen coincidiendo sin depender del navegador.
  perform public.preparar_ficha_cita(v_payload || jsonb_build_object(
    'request_id', 'a2100000-0000-4000-8000-000000000002',
    'cliente', 'QA LEDGER HOY',
    'fecha', v_hoy,
    'whatsapp_e164', '+51921000002',
    'monto_pagado', 10,
    'numero_operacion', 'QA-021-B',
    'cliente_id', 'CLI-QA-021-B',
    'movimiento_id', 'MOV-QA-021-B',
    'reserva_id', 'RES-QA-021-B',
    'pago_id', 'PAY-QA-021-B',
    'token', repeat('B', 43),
    'token_expira', (v_hoy::timestamp + time '18:00') at time zone 'America/Lima'
  ));
  if (select fecha from public.caja_movimientos where movimiento_id = 'MOV-QA-021-B') <> v_hoy
     or (select fecha from public.caja_pagos where pago_id = 'PAY-QA-021-B') <> v_hoy then
    raise exception 'QA_021_CASE_B_SAME_DAY';
  end if;

  -- La segunda RPC comparte el mismo contrato de fecha de cobro.
  perform public.preparar_atencion_personalizada(jsonb_build_object(
    'request_id', 'a2100000-0000-4000-8000-000000000003',
    'canal', 'directo',
    'personas', 1,
    'cliente', 'QA LEDGER PERSONALIZADA',
    'fecha', v_hoy + 2,
    'hora', '12:00',
    'whatsapp_e164', '+51921000003',
    'pais_telefono', 'PE',
    'tipo_atencion', 'sede',
    'sede', 'Miraflores',
    'modalidad_ejecucion', 'simultanea',
    'confirmar_disponibilidad', true,
    'componentes_por_persona', jsonb_build_array(jsonb_build_object(
      'persona', 1,
      'componentes', jsonb_build_array(jsonb_build_object(
        'tipo', 'manual', 'nombre', 'QA manual', 'precio', 115, 'duracion_min', 60
      ))
    )),
    'precio_final_acordado', 115,
    'monto_pagado', 10,
    'metodo_pago', 'EFECTIVO',
    'cliente_id', 'CLI-QA-021-C',
    'movimiento_id', 'MOV-QA-021-C',
    'reserva_id', 'RES-QA-021-C',
    'pago_id', 'PAY-QA-021-C',
    'token', repeat('C', 43),
    'token_expira', ((v_hoy + 2)::timestamp + time '18:00') at time zone 'America/Lima'
  ));
  if (select fecha from public.caja_pagos where pago_id = 'PAY-QA-021-C') <> v_hoy then
    raise exception 'QA_021_PERSONALIZED_REAL_PAYMENT_DATE';
  end if;

  -- ATENCION_APP también es ingreso de servicios; la reclasificación no altera el total.
  insert into public.caja_movimientos (
    movimiento_id, fecha, hora, sede, tipo_movimiento, total_pagado
  ) values (
    'MOV-QA-021-ATENCION', v_hoy, time '13:00', 'Miraflores', 'ATENCION_APP', 25
  );
  insert into public.caja_pagos (
    pago_id, movimiento_id, fecha, hora, sede, tipo_pago, metodo, monto, concepto
  ) values (
    'PAY-QA-021-ATENCION', 'MOV-QA-021-ATENCION', v_hoy, time '13:00',
    'Miraflores', 'PAGO_QA', 'YAPE', 25, 'Atención app QA'
  );

  -- Caso D: el modelo admite varios pagos en fechas distintas para un movimiento.
  insert into public.caja_pagos (
    pago_id, movimiento_id, fecha, hora, sede, tipo_pago, metodo, monto, concepto
  ) values (
    'PAY-QA-021-A-2', 'MOV-QA-021-A', v_hoy + 1, time '10:00',
    'Miraflores', 'SALDO_QA', 'EFECTIVO', 5, 'Segundo pago QA'
  );
  update public.caja_movimientos
  set total_pagado = total_pagado + 5,
      pendiente = greatest(total_cobrar - (total_pagado + 5), 0)
  where movimiento_id = 'MOV-QA-021-A';

  if (select count(*) from public.caja_pagos where movimiento_id = 'MOV-QA-021-A') <> 2
     or (select coalesce(sum(monto), 0) from public.caja_pagos where movimiento_id = 'MOV-QA-021-A')
        <> (select total_pagado from public.caja_movimientos where movimiento_id = 'MOV-QA-021-A') then
    raise exception 'QA_021_CASE_D_MULTI_PAYMENT_RECONCILIATION';
  end if;

  -- Casos E/F: el adelanto entra hoy y no vuelve a entrar en la fecha de cita.
  if not exists (
    select 1 from public.caja_pagos
    where movimiento_id = 'MOV-QA-021-A' and fecha = v_hoy and monto = 115
  ) or exists (
    select 1 from public.caja_pagos
    where movimiento_id = 'MOV-QA-021-A' and fecha = v_fecha_cita
  ) then
    raise exception 'QA_021_CASE_E_F_ADVANCE_COUNTED_ONCE';
  end if;

  select coalesce(sum(monto), 0) into v_total_dia
  from public.caja_pagos where fecha = v_hoy and sede = 'Miraflores';
  if (select total_pagado from public.vista_ingresos_por_fecha where fecha = v_hoy and sede = 'Miraflores') <> v_total_dia then
    raise exception 'QA_021_DAILY_VIEW_NOT_FROM_LEDGER';
  end if;

  if not exists (
    select 1
    from public.vista_reporte_financiero_mensual v
    where v.mes = date_trunc('month', v_hoy)::date
      and v.sede = 'Miraflores'
      and v.ingresos_servicios = (
        select coalesce(sum(p.monto), 0)
        from public.caja_pagos p
        join public.caja_movimientos m on m.movimiento_id = p.movimiento_id
        where date_trunc('month', p.fecha)::date = date_trunc('month', v_hoy)::date
          and p.sede = 'Miraflores'
          and m.tipo_movimiento in ('ATENCION_HISTORICA', 'RESERVA_APP', 'ATENCION_APP')
      )
      and v.otros_ingresos = (
        select coalesce(sum(p.monto), 0)
        from public.caja_pagos p
        left join public.caja_movimientos m on m.movimiento_id = p.movimiento_id
        where date_trunc('month', p.fecha)::date = date_trunc('month', v_hoy)::date
          and p.sede = 'Miraflores'
          and (m.tipo_movimiento is null or m.tipo_movimiento not in (
            'ATENCION_HISTORICA', 'RESERVA_APP', 'ATENCION_APP',
            'GIFT_CARD_VENTA', 'PRESTAMO_CAJA_INGRESO', 'CUPONIDAD'
          ))
      )
      and v.total_ingresos_confirmados = (
        select coalesce(sum(p.monto), 0)
        from public.caja_pagos p
        where date_trunc('month', p.fecha)::date = date_trunc('month', v_hoy)::date
          and p.sede = 'Miraflores'
      )
  ) then
    raise exception 'QA_021_FINANCIAL_CLASSIFICATION';
  end if;

  if exists (
    select 1
    from public.caja_movimientos m
    left join lateral (
      select coalesce(sum(p.monto), 0) as total_pagos
      from public.caja_pagos p where p.movimiento_id = m.movimiento_id
    ) p on true
    where m.movimiento_id like 'MOV-QA-021-%'
      and m.total_pagado <> p.total_pagos
  ) then
    raise exception 'QA_021_NEW_OPERATION_RECONCILIATION';
  end if;

  if has_function_privilege('anon', 'public.preparar_ficha_cita(jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.preparar_ficha_cita(jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.preparar_ficha_cita(jsonb)', 'EXECUTE') then
    raise exception 'QA_021_RPC_PRIVILEGES';
  end if;
end;
$$;

rollback;

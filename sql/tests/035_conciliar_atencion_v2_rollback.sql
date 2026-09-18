begin;

-- QA transaccional de conciliar_atencion_v2.
-- Requiere 034 + 035 aplicadas en la base de QA/staging.
-- Todo se revierte al final; no deja residuos.

do $$
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
  v_ahora time := (now() at time zone 'America/Lima')::time;
  v_result jsonb;
  v_replay jsonb;
  v_terapista uuid := '35000000-0000-4000-8000-000000000001';
  v_count integer;
begin
  -- Fixture de terapista para propinas.
  insert into public.terapistas(terapista_id,nombre,estado,observacion)
  values(v_terapista,'QA V2 Terapista','ACTIVA','Fixture rollback 035')
  on conflict (terapista_id) do update set estado='ACTIVA';

  -- ==========================================================
  -- CASE_A: saldo S/50 dividido en S/20 efectivo + S/30 Yape.
  -- ==========================================================
  insert into public.caja_movimientos(
    movimiento_id,fecha,hora,sede,tipo_movimiento,estado,cliente,n_pax,servicio,
    monto_servicio,total_extras,total_cobrar,total_pagado,pendiente,responsable,source_type,source_id
  ) values(
    'MOV-QA-V2-A',v_hoy,v_ahora,'Miraflores','ATENCION_APP','En atención','QA V2 A',1,'Servicio QA',
    100,0,100,50,50,'QA','QA_V2','CASE_A'
  );
  insert into public.caja_pagos(pago_id,movimiento_id,fecha,hora,sede,tipo_pago,metodo,monto,concepto)
  values('PAY-QA-V2-A-ADV','MOV-QA-V2-A',v_hoy,v_ahora,'Miraflores','ADELANTO_APP','YAPE',50,'Adelanto QA');

  v_result := public.conciliar_atencion_v2(jsonb_build_object(
    'request_id','35000000-0000-4000-8000-00000000000a',
    'movimiento_id','MOV-QA-V2-A','responsable','QA',
    'pagos',jsonb_build_array(
      jsonb_build_object('metodo','EFECTIVO','monto',20),
      jsonb_build_object('metodo','YAPE','monto',30,'numero_operacion','QA-YAPE-A')
    )
  ));
  if (v_result->>'pendiente')::numeric <> 0 or (v_result->>'total_pagado')::numeric <> 100 then
    raise exception 'CASE_A_RESULTADO_INVALIDO_%',v_result;
  end if;
  select count(*) into v_count from public.caja_pagos where movimiento_id='MOV-QA-V2-A';
  if v_count <> 3 then raise exception 'CASE_A_PAGOS_ESPERADOS_3_ENCONTRADOS_%',v_count; end if;

  -- Reintento idéntico: no debe duplicar pagos.
  v_replay := public.conciliar_atencion_v2(jsonb_build_object(
    'request_id','35000000-0000-4000-8000-00000000000a',
    'movimiento_id','MOV-QA-V2-A','responsable','QA',
    'pagos',jsonb_build_array(
      jsonb_build_object('metodo','EFECTIVO','monto',20),
      jsonb_build_object('metodo','YAPE','monto',30,'numero_operacion','QA-YAPE-A')
    )
  ));
  if coalesce((v_replay->>'reutilizado')::boolean,false) is not true then
    raise exception 'CASE_A_REPLAY_NO_IDEMPOTENTE_%',v_replay;
  end if;
  select count(*) into v_count from public.caja_pagos where movimiento_id='MOV-QA-V2-A';
  if v_count <> 3 then raise exception 'CASE_A_REPLAY_DUPLICO_PAGOS_%',v_count; end if;

  -- ==========================================================
  -- CASE_B: adelanto S/10 + upselling S/10 + pago final S/70.
  -- ==========================================================
  insert into public.caja_movimientos(
    movimiento_id,fecha,hora,sede,tipo_movimiento,estado,cliente,n_pax,servicio,
    monto_servicio,total_extras,total_cobrar,total_pagado,pendiente,responsable,source_type,source_id
  ) values(
    'MOV-QA-V2-B',v_hoy,v_ahora,'Miraflores','ATENCION_APP','En atención','QA V2 B',1,'Servicio QA',
    70,0,70,10,60,'QA','QA_V2','CASE_B'
  );
  insert into public.caja_pagos(pago_id,movimiento_id,fecha,hora,sede,tipo_pago,metodo,monto,concepto)
  values('PAY-QA-V2-B-ADV','MOV-QA-V2-B',v_hoy,v_ahora,'Miraflores','ADELANTO_APP','EFECTIVO',10,'Adelanto QA');

  v_result := public.conciliar_atencion_v2(jsonb_build_object(
    'request_id','35000000-0000-4000-8000-00000000000b',
    'movimiento_id','MOV-QA-V2-B','responsable','QA',
    'extras',jsonb_build_array(jsonb_build_object(
      'tipo','MINUTOS_EXTRA','concepto','+10 minutos','cantidad',1,'monto_unitario',10,'duracion_extra_min',10
    )),
    'pagos',jsonb_build_array(jsonb_build_object('metodo','EFECTIVO','monto',70))
  ));
  if (v_result->>'total_cobrar')::numeric <> 80 or (v_result->>'pendiente')::numeric <> 0 then
    raise exception 'CASE_B_RESULTADO_INVALIDO_%',v_result;
  end if;
  if (select total_extras from public.caja_movimientos where movimiento_id='MOV-QA-V2-B') <> 10 then
    raise exception 'CASE_B_EXTRA_NO_PERSISTIDO';
  end if;

  -- ==========================================================
  -- CASE_C: paquete S/200, adelanto S/100, saldo S/100 tarjeta
  -- + propina S/20 tarjeta para terapista. Propina no es ingreso.
  -- ==========================================================
  insert into public.caja_movimientos(
    movimiento_id,fecha,hora,sede,tipo_movimiento,estado,cliente,n_pax,servicio,
    monto_servicio,total_extras,total_cobrar,total_pagado,pendiente,responsable,source_type,source_id
  ) values(
    'MOV-QA-V2-C',v_hoy,v_ahora,'San Borja','ATENCION_APP','En atención','QA V2 C',2,'Paquete dos QA',
    200,0,200,100,100,'QA','QA_V2','CASE_C'
  );
  insert into public.caja_pagos(pago_id,movimiento_id,fecha,hora,sede,tipo_pago,metodo,monto,concepto)
  values('PAY-QA-V2-C-ADV','MOV-QA-V2-C',v_hoy,v_ahora,'San Borja','ADELANTO_APP','YAPE',100,'Adelanto QA');

  v_result := public.conciliar_atencion_v2(jsonb_build_object(
    'request_id','35000000-0000-4000-8000-00000000000c',
    'movimiento_id','MOV-QA-V2-C','responsable','QA',
    'pagos',jsonb_build_array(jsonb_build_object('metodo','IZIPAY POS','monto',100,'numero_operacion','QA-POS-C')),
    'propina',jsonb_build_object(
      'monto',20,'metodo','IZIPAY POS','numero_operacion','QA-POS-C',
      'distribucion',jsonb_build_array(jsonb_build_object('terapista_id',v_terapista::text,'monto',20))
    )
  ));
  if (v_result->>'total_pagado')::numeric <> 200 or (v_result->>'propina_registrada')::numeric <> 20 then
    raise exception 'CASE_C_RESULTADO_INVALIDO_%',v_result;
  end if;
  if (select coalesce(sum(monto),0) from public.caja_pagos where movimiento_id='MOV-QA-V2-C') <> 200 then
    raise exception 'CASE_C_PROPINA_CONTAMINO_CAJA_PAGOS';
  end if;
  if (select coalesce(sum(monto),0) from public.caja_propinas where movimiento_id='MOV-QA-V2-C') <> 20 then
    raise exception 'CASE_C_PROPINA_NO_REGISTRADA';
  end if;

  -- ==========================================================
  -- CASE_D: descuento S/10 sobre servicio S/70; adelanto S/10;
  -- pago final S/50. Venta neta S/60.
  -- ==========================================================
  insert into public.caja_movimientos(
    movimiento_id,fecha,hora,sede,tipo_movimiento,estado,cliente,n_pax,servicio,
    monto_servicio,total_extras,total_cobrar,total_pagado,pendiente,responsable,source_type,source_id
  ) values(
    'MOV-QA-V2-D',v_hoy,v_ahora,'Miraflores','ATENCION_APP','En atención','QA V2 D',1,'Servicio QA',
    70,0,70,10,60,'QA','QA_V2','CASE_D'
  );
  insert into public.caja_pagos(pago_id,movimiento_id,fecha,hora,sede,tipo_pago,metodo,monto,concepto)
  values('PAY-QA-V2-D-ADV','MOV-QA-V2-D',v_hoy,v_ahora,'Miraflores','ADELANTO_APP','EFECTIVO',10,'Adelanto QA');

  v_result := public.conciliar_atencion_v2(jsonb_build_object(
    'request_id','35000000-0000-4000-8000-00000000000d',
    'movimiento_id','MOV-QA-V2-D','responsable','QA',
    'ajustes',jsonb_build_array(jsonb_build_object('tipo','DESCUENTO','monto',10,'motivo','QA cliente frecuente')),
    'pagos',jsonb_build_array(jsonb_build_object('metodo','EFECTIVO','monto',50))
  ));
  if (v_result->>'total_cobrar')::numeric <> 60 or (v_result->>'pendiente')::numeric <> 0 then
    raise exception 'CASE_D_RESULTADO_INVALIDO_%',v_result;
  end if;

  -- ==========================================================
  -- CASE_E: Bee Beneficios reconoce S/65; cliente no paga nada.
  -- La cobertura liquida la atención sin fingir caja recibida.
  -- ==========================================================
  insert into public.caja_movimientos(
    movimiento_id,fecha,hora,sede,tipo_movimiento,estado,cliente,n_pax,servicio,
    monto_servicio,total_extras,total_cobrar,total_pagado,pendiente,responsable,source_type,source_id
  ) values(
    'MOV-QA-V2-E',v_hoy,v_ahora,'Miraflores','ATENCION_APP','En atención','QA V2 E',1,'Servicio Bee QA',
    65,0,65,0,65,'QA','QA_V2','CASE_E'
  );
  insert into public.cupones_convenios(
    registro_id,fecha,hora,sede,plataforma,codigo_cupon,cliente,n_pax,servicio,
    monto_reconocido,monto_cobrado_tienda,responsable
  ) values(
    'CONV-QA-V2-E',v_hoy,v_ahora,'Miraflores','Bee Beneficios','BEE-QA-E','QA V2 E',1,'Servicio Bee QA',65,0,'QA'
  );

  v_result := public.conciliar_atencion_v2(jsonb_build_object(
    'request_id','35000000-0000-4000-8000-00000000000e',
    'movimiento_id','MOV-QA-V2-E','responsable','QA',
    'coberturas',jsonb_build_array(jsonb_build_object(
      'tipo','CONVENIO_BEE','referencia_id','CONV-QA-V2-E','monto',65
    ))
  ));
  if (v_result->>'pendiente')::numeric <> 0 or (v_result->>'total_pagado')::numeric <> 0
     or (v_result->>'coberturas_totales')::numeric <> 65 then
    raise exception 'CASE_E_RESULTADO_INVALIDO_%',v_result;
  end if;
  if exists(select 1 from public.caja_pagos where movimiento_id='MOV-QA-V2-E') then
    raise exception 'CASE_E_CONVENIO_CREO_PAGO_FALSO';
  end if;

  raise notice 'QA_035_OK CASE_A CASE_B CASE_C CASE_D CASE_E';
end $$;

rollback;

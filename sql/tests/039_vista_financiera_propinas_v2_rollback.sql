begin;

-- Una propina V2 debe seguir visible en total_propina_detalle,
-- pero no generar diferencia financiera ni contaminar total_cobrar.
-- El fixture no depende de que caja_movimientos tenga la columna legacy
-- total_propina: V2 debe funcionar igual en ambos esquemas históricos.
do $$
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
  v_ahora time := (now() at time zone 'America/Lima')::time;
  v_terapista uuid := '35000000-0000-4000-8000-000000000039';
  v_propina uuid := '39000000-0000-4000-8000-000000000039';
  v_row record;
begin
  insert into public.terapistas(terapista_id,nombre,estado,observacion)
  values(v_terapista,'QA Vista Propina','ACTIVA','Fixture rollback 039')
  on conflict (terapista_id) do update set estado='ACTIVA';

  insert into public.caja_movimientos(
    movimiento_id,fecha,hora,sede,tipo_movimiento,estado,cliente,n_pax,servicio,
    monto_servicio,total_extras,total_cobrar,total_pagado,pendiente,responsable,source_type,source_id
  ) values(
    'MOV-QA-V2-VISTA-PROPINA',v_hoy,v_ahora,'Miraflores','ATENCION_APP','Atendido','QA Vista',1,'Servicio QA',
    88,0,88,88,0,'QA','QA_V2','CASE_039'
  );

  insert into public.caja_pagos(
    pago_id,movimiento_id,fecha,hora,sede,tipo_pago,metodo,monto,concepto
  ) values(
    'PAY-QA-V2-VISTA-PROPINA','MOV-QA-V2-VISTA-PROPINA',v_hoy,v_ahora,'Miraflores','SALDO_ATENCION_V2','YAPE',88,'Pago QA'
  );

  insert into public.caja_atencion_detalle(
    detalle_id,movimiento_id,fecha,sede,persona_n,terapista,servicio,duracion,monto_asignado
  ) values(
    'DET-QA-V2-VISTA-PROPINA','MOV-QA-V2-VISTA-PROPINA',v_hoy,'Miraflores',1,'QA Vista Propina','Servicio QA',60,88
  );

  insert into public.caja_propinas(
    propina_id,movimiento_id,fecha,fecha_operativa,hora,sede,metodo,numero_operacion,monto,monto_total,estado,responsable,request_id
  ) values(
    v_propina,'MOV-QA-V2-VISTA-PROPINA',v_hoy,v_hoy,v_ahora,'Miraflores','YAPE','QA-039',20,20,'PENDIENTE','QA','39000000-0000-4000-8000-000000000001'
  );

  insert into public.caja_propina_distribucion(
    propina_id,terapista_id,terapista,monto
  ) values(
    v_propina,v_terapista,'QA Vista Propina',20
  );

  set constraints all immediate;

  select * into v_row
  from public.vista_caja_movimiento_financiero_v2
  where movimiento_id='MOV-QA-V2-VISTA-PROPINA';

  if v_row.total_propina_detalle <> 20 then
    raise exception '039_PROPINA_DETALLE_NO_VISIBLE_%',v_row.total_propina_detalle;
  end if;
  if v_row.diferencia_conciliacion_propina <> 0 then
    raise exception '039_FALSA_DIFERENCIA_PROPINA_%',v_row.diferencia_conciliacion_propina;
  end if;
  if v_row.diferencia_conciliacion is true then
    raise exception '039_FALSA_DIFERENCIA_GENERAL';
  end if;
  if v_row.total_cobrar <> 88 or v_row.cobro_total <> 88 then
    raise exception '039_PROPINA_CONTAMINO_VENTA';
  end if;

  raise notice 'QA_039_VISTA_PROPINA_V2_OK';
end $$;

rollback;

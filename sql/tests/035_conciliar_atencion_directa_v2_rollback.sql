begin;

-- QA: una atención directa ATENCION_APP/Registrado puede conciliarse sin reserva.
-- Todo se revierte al final.
do $$
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
  v_ahora time := (now() at time zone 'America/Lima')::time;
  v_result jsonb;
begin
  insert into public.caja_movimientos(
    movimiento_id,fecha,hora,sede,tipo_movimiento,estado,cliente,n_pax,servicio,
    monto_servicio,total_extras,total_cobrar,total_pagado,pendiente,responsable,source_type,source_id
  ) values(
    'MOV-QA-V2-DIRECTA',v_hoy,v_ahora,'Miraflores','ATENCION_APP','Registrado','QA Directa',1,'Servicio QA',
    70,0,70,10,60,'QA','NUEVA_ATENCION','QA-DIRECTA'
  );

  insert into public.caja_pagos(
    pago_id,movimiento_id,fecha,hora,sede,tipo_pago,metodo,monto,concepto
  ) values(
    'PAY-QA-V2-DIRECTA-ADV','MOV-QA-V2-DIRECTA',v_hoy,v_ahora,'Miraflores','ADELANTO_APP','EFECTIVO',10,'Adelanto QA'
  );

  v_result := public.conciliar_atencion_v2(jsonb_build_object(
    'request_id','35000000-0000-4000-8000-0000000000f1',
    'movimiento_id','MOV-QA-V2-DIRECTA',
    'responsable','QA',
    'pagos',jsonb_build_array(
      jsonb_build_object('metodo','YAPE','monto',60,'numero_operacion','QA-DIRECTA-YAPE')
    )
  ));

  if (v_result->>'reserva_id') is not null then
    raise exception 'DIRECTA_CREO_RESERVA_%',v_result;
  end if;
  if coalesce((v_result->>'completada')::boolean,false) is not true
     or (v_result->>'total_pagado')::numeric <> 70
     or (v_result->>'pendiente')::numeric <> 0 then
    raise exception 'DIRECTA_RESULTADO_INVALIDO_%',v_result;
  end if;
  if (select estado from public.caja_movimientos where movimiento_id='MOV-QA-V2-DIRECTA') <> 'Atendido' then
    raise exception 'DIRECTA_NO_QUEDO_ATENDIDA';
  end if;
  if (select count(*) from public.caja_pagos where movimiento_id='MOV-QA-V2-DIRECTA') <> 2 then
    raise exception 'DIRECTA_PAGOS_INVALIDOS';
  end if;

  raise notice 'QA_035_DIRECTA_OK';
end $$;

rollback;

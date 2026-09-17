begin;

do $$
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
  v_ahora time := (now() at time zone 'America/Lima')::time;
begin
  insert into public.caja_movimientos(
    movimiento_id,fecha,hora,sede,tipo_movimiento,estado,cliente,n_pax,servicio,
    monto_servicio,total_extras,total_cobrar,total_pagado,pendiente,responsable,source_type,source_id
  ) values
    ('MOV-QA-037-A',v_hoy,v_ahora,'Miraflores','ATENCION_APP','En atención','QA 037 A',1,'Bee QA',65,0,65,0,65,'QA','APP_CAJA_FICHA','RES-QA-037-A'),
    ('MOV-QA-037-B',v_hoy,v_ahora,'Miraflores','ATENCION_APP','En atención','QA 037 B',1,'Bee QA',65,0,65,0,65,'QA','APP_CAJA_FICHA','RES-QA-037-B');

  insert into public.cupones_convenios(
    registro_id,fecha,hora,sede,plataforma,codigo_cupon,cliente,n_pax,servicio,
    monto_reconocido,monto_cobrado_tienda,responsable,estado,reserva_id
  ) values(
    'CONV-QA-037-A',v_hoy,v_ahora,'Miraflores','Bee Beneficios','BEE-QA-037-A',
    'QA 037 A',1,'Bee QA',65,0,'QA','verificado','RES-QA-037-A'
  );

  -- CASE_A: cobertura válida para su propia reserva y queda canjeada.
  insert into public.caja_atencion_coberturas(
    movimiento_id,tipo,referencia_id,monto,estado,responsable,request_id
  ) values(
    'MOV-QA-037-A','CONVENIO_BEE','CONV-QA-037-A',65,'APLICADA','QA',
    '37000000-0000-4000-8000-00000000000a'
  );

  if (select estado from public.cupones_convenios where registro_id='CONV-QA-037-A') <> 'canjeado' then
    raise exception 'CASE_A_CONVENIO_NO_CANJEADO';
  end if;

  -- CASE_B: la misma referencia no puede aplicarse a otra reserva.
  begin
    insert into public.caja_atencion_coberturas(
      movimiento_id,tipo,referencia_id,monto,estado,responsable,request_id
    ) values(
      'MOV-QA-037-B','CONVENIO_BEE','CONV-QA-037-A',65,'APLICADA','QA',
      '37000000-0000-4000-8000-00000000000b'
    );
    raise exception 'CASE_B_DEBIO_RECHAZAR_CONVENIO_CRUZADO';
  exception
    when check_violation then
      if position('CONVENIO_NO_PERTENECE_A_RESERVA' in sqlerrm)=0 then
        raise;
      end if;
  end;

  raise notice 'QA_037_OK CASE_A CASE_B';
end $$;

rollback;

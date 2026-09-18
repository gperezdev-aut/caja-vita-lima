begin;

do $$
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
  v_ahora time := (now() at time zone 'America/Lima')::time;
  v_allison uuid;
  v_marivel uuid;
  v_propina uuid := '38000000-0000-4000-8000-000000000001';
begin
  select terapista_id into v_allison from public.terapistas where nombre='Allison' and estado='ACTIVA';
  select terapista_id into v_marivel from public.terapistas where nombre='Marivel' and estado='ACTIVA';
  if v_allison is null or v_marivel is null then
    raise exception 'QA_038_MAESTRO_TERAPISTAS_INCOMPLETO';
  end if;

  insert into public.caja_movimientos(
    movimiento_id,fecha,hora,sede,tipo_movimiento,estado,cliente,n_pax,servicio,
    monto_servicio,total_extras,total_cobrar,total_pagado,pendiente,responsable,source_type,source_id
  ) values(
    'MOV-QA-038-A',v_hoy,v_ahora,'Miraflores','ATENCION_APP','Atendido','QA 038',1,'Servicio QA',
    100,0,100,100,0,'QA','QA_V2','CASE_038'
  );

  insert into public.caja_atencion_detalle(
    detalle_id,movimiento_id,fecha,sede,persona_n,terapista,servicio,monto_asignado
  ) values(
    'DET-QA-038-A','MOV-QA-038-A',v_hoy,'Miraflores',1,'Allison','Servicio QA',100
  );

  insert into public.caja_propinas(
    propina_id,movimiento_id,fecha,hora,sede,metodo,monto,estado,responsable,request_id
  ) values(
    v_propina,'MOV-QA-038-A',v_hoy,v_ahora,'Miraflores','EFECTIVO',20,'PENDIENTE','QA',
    '38000000-0000-4000-8000-000000000010'
  );

  -- CASE_A: terapista que sí atendió puede recibir la propina.
  insert into public.caja_propina_distribucion(propina_id,terapista_id,monto,estado)
  values(v_propina,v_allison,20,'PENDIENTE');

  if not exists(
    select 1 from public.caja_propina_distribucion
    where propina_id=v_propina and terapista_id=v_allison and monto=20
  ) then
    raise exception 'CASE_A_DISTRIBUCION_VALIDA_NO_PERSISTIO';
  end if;

  -- CASE_B: una terapista activa que no atendió debe ser rechazada.
  begin
    update public.caja_propina_distribucion
    set terapista_id=v_marivel
    where propina_id=v_propina and terapista_id=v_allison;
    raise exception 'CASE_B_DEBIO_RECHAZAR_TERAPISTA_AJENA';
  exception
    when check_violation then
      if position('PROPINA_TERAPISTA_NO_ATENDIO' in sqlerrm)=0 then
        raise;
      end if;
  end;

  raise notice 'QA_038_OK CASE_A CASE_B';
end $$;

rollback;

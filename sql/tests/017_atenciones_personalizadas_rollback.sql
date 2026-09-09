-- Validación manual posterior a 017. No ejecutar en producción: las escrituras
-- QA se descartan con ROLLBACK y el bloque final confirma que no quedaron residuos.
begin;

do $$
declare
  v_fecha date := (now() at time zone 'America/Lima')::date + 45;
  v_sede text;
  v_hora time;
  v_metodo text;
  v_operacion text := null;
  v_resultado jsonb;
  v_payload jsonb;
begin
  select nombre, hora_apertura, upper(btrim(valor))
  into v_sede, v_hora, v_metodo
  from public.sedes cross join lateral (
    select valor from public.config_listas
    where lista = 'METODOS_PAGO' and activo is true
    order by case when upper(btrim(valor)) = 'EFECTIVO' then 0 else 1 end
    limit 1
  ) metodo
  where sedes.activo is true
    and hora_apertura is not null and hora_cierre >= hora_apertura + interval '180 minutes'
  order by sedes.nombre
  limit 1;
  if v_sede is null or v_metodo is null then
    raise exception 'Se requiere una sede activa y un método de pago configurado para QA 017';
  end if;
  if v_metodo <> 'EFECTIVO' then v_operacion := 'QA-017-OPERACION'; end if;

  -- Una persona: S/100, adelanto S/10, token al final de la atención.
  v_payload := jsonb_build_object(
    'request_id', 'a1700001-0000-4000-8000-000000000001', 'canal', 'directo',
    'personas', 1, 'fecha', v_fecha::text, 'hora', v_hora::text, 'sede', v_sede,
    'tipo_atencion', 'sede', 'modalidad_ejecucion', 'simultanea', 'cliente', 'QA 017 Uno', 'whatsapp_e164', '+51917000001',
    'pais_telefono', 'PE', 'cliente_id', 'CLI-QA-017-1', 'movimiento_id', 'MOV-QA-017-1',
    'reserva_id', 'RES-QA-017-1', 'pago_id', 'PAY-QA-017-1', 'token', repeat('P', 43),
    'token_expira', (((v_fecha + v_hora) + interval '60 minutes') at time zone 'America/Lima')::text,
    'componentes_por_persona', jsonb_build_array(jsonb_build_object('persona', 1,
      'componentes', jsonb_build_array(jsonb_build_object('tipo', 'manual', 'nombre', 'Manual QA', 'precio', 100, 'duracion_min', 60)))),
    'precio_final_acordado', 100, 'confirmar_disponibilidad', true, 'monto_pagado', 10,
    'metodo_pago', v_metodo, 'numero_operacion', v_operacion, 'responsable', 'QA rollback'
  );
  v_resultado := public.preparar_atencion_personalizada(v_payload);
  if v_resultado->>'reserva_id' <> 'RES-QA-017-1' or (v_resultado->>'adelanto_requerido')::numeric <> 10 then
    raise exception 'Falló personalizada de una persona';
  end if;
  if (public.preparar_atencion_personalizada(v_payload)->>'reutilizado')::boolean is not true
     or (select count(*) from public.citas_reservadas where request_id = 'a1700001-0000-4000-8000-000000000001') <> 1 then
    raise exception 'Falló idempotencia de personalizada';
  end if;

  -- Tres personas simultáneas: la duración es el máximo (90), y el adelanto 50%.
  v_payload := v_payload || jsonb_build_object(
    'request_id', 'a1700001-0000-4000-8000-000000000002', 'cliente_id', 'CLI-QA-017-2',
    'movimiento_id', 'MOV-QA-017-2', 'reserva_id', 'RES-QA-017-2', 'pago_id', 'PAY-QA-017-2',
    'token', repeat('Q', 43), 'whatsapp_e164', '+51917000002', 'personas', 3,
    'componentes_por_persona', jsonb_build_array(
      jsonb_build_object('persona', 1, 'componentes', jsonb_build_array(jsonb_build_object('tipo','manual','nombre','A','precio',100,'duracion_min',60))),
      jsonb_build_object('persona', 2, 'componentes', jsonb_build_array(jsonb_build_object('tipo','manual','nombre','B','precio',100,'duracion_min',90))),
      jsonb_build_object('persona', 3, 'componentes', jsonb_build_array(jsonb_build_object('tipo','manual','nombre','C','precio',100,'duracion_min',30)))
    ), 'precio_final_acordado', 300, 'monto_pagado', 150,
    'token_expira', (((v_fecha + v_hora) + interval '90 minutes') at time zone 'America/Lima')::text
  );
  perform public.preparar_atencion_personalizada(v_payload);
  if not exists (select 1 from public.citas_reservadas where reserva_id = 'RES-QA-017-2' and duracion_min = 90 and adelanto = 150) then
    raise exception 'Falló duración simultánea o adelanto de tres personas';
  end if;

  -- Consecutiva y varios servicios de una persona: duración suma 150 minutos.
  v_payload := v_payload || jsonb_build_object(
    'request_id', 'a1700001-0000-4000-8000-000000000003', 'cliente_id', 'CLI-QA-017-3',
    'movimiento_id', 'MOV-QA-017-3', 'reserva_id', 'RES-QA-017-3', 'pago_id', 'PAY-QA-017-3',
    'token', repeat('R', 43), 'whatsapp_e164', '+51917000003', 'personas', 2,
    'modalidad_ejecucion', 'consecutiva',
    'componentes_por_persona', jsonb_build_array(
      jsonb_build_object('persona', 1, 'componentes', jsonb_build_array(
        jsonb_build_object('tipo','manual','nombre','A1','precio',100,'duracion_min',60),
        jsonb_build_object('tipo','manual','nombre','A2','precio',50,'duracion_min',30))),
      jsonb_build_object('persona', 2, 'componentes', jsonb_build_array(jsonb_build_object('tipo','manual','nombre','B','precio',100,'duracion_min',60)))
    ), 'precio_final_acordado', 250, 'monto_pagado', 125,
    'token_expira', (((v_fecha + v_hora) + interval '150 minutes') at time zone 'America/Lima')::text
  );
  perform public.preparar_atencion_personalizada(v_payload);
  if not exists (select 1 from public.citas_reservadas where reserva_id = 'RES-QA-017-3' and duracion_min = 150 and adelanto = 125) then
    raise exception 'Falló duración consecutiva o varios componentes';
  end if;

  -- Precio ajustado requiere motivo y conserva la auditoría; sin motivo se rechaza.
  v_payload := v_payload || jsonb_build_object(
    'request_id', 'a1700001-0000-4000-8000-000000000004', 'cliente_id', 'CLI-QA-017-4',
    'movimiento_id', 'MOV-QA-017-4', 'reserva_id', 'RES-QA-017-4', 'pago_id', 'PAY-QA-017-4',
    'token', repeat('S', 43), 'whatsapp_e164', '+51917000004', 'personas', 1,
    'modalidad_ejecucion', 'simultanea', 'precio_final_acordado', 90, 'monto_pagado', 10,
    'motivo_ajuste', 'Cortesía QA', 'componentes_por_persona', jsonb_build_array(jsonb_build_object('persona',1,
      'componentes',jsonb_build_array(jsonb_build_object('tipo','manual','nombre','A','precio',100,'duracion_min',60)))),
    'token_expira', (((v_fecha + v_hora) + interval '60 minutes') at time zone 'America/Lima')::text
  );
  perform public.preparar_atencion_personalizada(v_payload);
  if not exists (select 1 from public.citas_reservadas where reserva_id = 'RES-QA-017-4' and precio_calculado = 100 and precio_final_acordado = 90 and motivo_ajuste = 'Cortesía QA') then
    raise exception 'Falló auditoría de ajuste';
  end if;
  begin
    perform public.preparar_atencion_personalizada(v_payload || jsonb_build_object('request_id','a1700001-0000-4000-8000-000000000005','reserva_id','RES-QA-017-5','movimiento_id','MOV-QA-017-5','pago_id','PAY-QA-017-5','token',repeat('T',43),'motivo_ajuste',''));
    raise exception 'Debió rechazar ajuste sin motivo';
  exception when others then
    if sqlerrm not like '%AJUSTE_SIN_MOTIVO%' then raise; end if;
  end;

  -- Rechazos del alcance MVP: más de 5, domicilio, convenio, promoción y gift card.
  foreach v_resultado in array array[
    v_payload || jsonb_build_object('request_id','a1700001-0000-4000-8000-000000000006','personas',6),
    v_payload || jsonb_build_object('request_id','a1700001-0000-4000-8000-000000000007','tipo_atencion','domicilio'),
    v_payload || jsonb_build_object('request_id','a1700001-0000-4000-8000-000000000008','canal','cuponidad'),
    v_payload || jsonb_build_object('request_id','a1700001-0000-4000-8000-000000000009','cupon_promocional','PROMO'),
    v_payload || jsonb_build_object('request_id','a1700001-0000-4000-8000-000000000010','es_gift_card',true)
  ] loop
    begin
      perform public.preparar_atencion_personalizada(v_resultado);
      raise exception 'Debió rechazar combinación fuera del MVP';
    exception when others then
      if sqlerrm not like '%PERSONALIZADA_SOLO_DIRECTO_PRESENCIAL%' and sqlerrm not like '%PERSONALIZADA_INVALIDA%' then raise; end if;
    end;
  end loop;
end;
$$;

rollback;

do $$
begin
  if exists (select 1 from public.citas_reservadas where reserva_id like 'RES-QA-017-%')
     or exists (select 1 from public.caja_movimientos where movimiento_id like 'MOV-QA-017-%')
     or exists (select 1 from public.caja_pagos where pago_id like 'PAY-QA-017-%') then
    raise exception 'El rollback 017 dejó residuos QA';
  end if;
end;
$$;

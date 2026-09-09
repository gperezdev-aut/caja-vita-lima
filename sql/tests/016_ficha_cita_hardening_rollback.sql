-- Prueba PostgreSQL manual para ejecutar DESPUÉS de aplicar 015 y 016 en un
-- entorno de validación. Todo queda dentro de una transacción y termina en
-- ROLLBACK. No ejecutar en producción sin revisar primero los identificadores.
begin;

do $$
declare
  v_sede text;
  v_hora time;
  v_payload jsonb;
  v_primero jsonb;
  v_reintento jsonb;
  v_cliente_id text;
begin
  if to_regclass('public.solicitudes_comprobante') is null then
    raise exception 'Falta solicitudes_comprobante';
  end if;

  select nombre, hora_apertura into v_sede, v_hora
  from public.sedes where activo is true and hora_apertura is not null and hora_cierre is not null
  order by nombre limit 1;
  if v_sede is null then raise exception 'No existe sede activa para la prueba'; end if;

  if (select count(*) from public.stg_services_catalog_v5
      where btrim("CodeId"::text) = 'DOM-1H'
        and lower(coalesce(active::text, '')) in ('true','1','yes','si','sí')) <> 1 then
    raise exception 'DOM-1H debe existir exactamente una vez y estar activo';
  end if;

  v_payload := jsonb_build_object(
    'request_id', 'd9710c49-c6ae-45a4-8858-59e06d91f001',
    'canal', 'directo', 'personas', 1,
    'fecha', ((now() at time zone 'America/Lima')::date + 30)::text,
    'hora', v_hora::text, 'sede', v_sede, 'sede_operativa', v_sede,
    'tipo_atencion', 'domicilio', 'domicilio_distrito', 'Distrito QA',
    'domicilio_direccion', 'Dirección QA 123', 'domicilio_referencia', 'Referencia extensa QA',
    'cliente', 'Cliente QA Ficha', 'whatsapp_e164', '+51900000001', 'pais_telefono', 'PE',
    'servicios', jsonb_build_array(jsonb_build_object('codigo', 'DOM-1H')),
    'monto_total', 0.01, 'costo_movilidad', 999, -- deben ser ignorados
    'monto_pagado', 999, 'metodo_pago', 'EFECTIVO',
    'cliente_id', 'CLI-QA-FICHA-016', 'movimiento_id', 'MOV-QA-FICHA-016',
    'reserva_id', 'RES-QA-FICHA-016', 'pago_id', 'PAY-QA-FICHA-016',
    'token', repeat('A', 43), 'token_expira', (now() + interval '60 days')::text
  );

  v_primero := public.preparar_ficha_cita(v_payload);
  v_reintento := public.preparar_ficha_cita(v_payload);
  if v_primero->>'reserva_id' <> v_reintento->>'reserva_id'
     or v_primero->>'token' <> v_reintento->>'token'
     or coalesce((v_reintento->>'reutilizado')::boolean, false) is not true then
    raise exception 'Falló la idempotencia de preparar_ficha_cita';
  end if;
  if (select count(*) from public.citas_reservadas where request_id = 'd9710c49-c6ae-45a4-8858-59e06d91f001') <> 1
     or (select count(*) from public.caja_movimientos where source_id = 'RES-QA-FICHA-016') <> 1
     or (select count(*) from public.caja_pagos where movimiento_id = 'MOV-QA-FICHA-016') <> 1
     or (select count(*) from public.caja_atencion_detalle where movimiento_id = 'MOV-QA-FICHA-016') <> 1 then
    raise exception 'El reintento duplicó filas';
  end if;

  begin
    perform public.preparar_ficha_cita(v_payload || '{"cliente":"Contenido distinto"}'::jsonb);
    raise exception 'Debió rechazar request_id con contenido distinto';
  exception when sqlstate '23505' then
    if sqlerrm not like '%REQUEST_ID_PAYLOAD_CONFLICTO%' then raise; end if;
  end;

  select cliente_id into v_cliente_id from public.citas_reservadas where reserva_id = 'RES-QA-FICHA-016';
  update public.clientes set email = 'anterior@example.com', dni = '12345678', cumple_dia = 14,
    cumple_mes = 3, consent_promos_en = '2026-01-01T00:00:00Z' where cliente_id = v_cliente_id;

  perform public.completar_ficha_cita(repeat('A', 43), jsonb_build_object(
    'cliente_id', v_cliente_id, 'nombre', 'Cliente QA Actualizado',
    'whatsapp_e164', '+51900000001', 'pais_telefono', 'PE', 'idioma', 'es',
    'consent_promos', false, 'guardar_salud', false, 'solicita_comprobante', false
  ));

  if not exists (select 1 from public.clientes where cliente_id = v_cliente_id
      and email = 'anterior@example.com' and dni = '12345678' and cumple_dia = 14 and cumple_mes = 3
      and consent_promos_en = '2026-01-01T00:00:00Z') then
    raise exception 'completar_ficha_cita borró datos previos';
  end if;
  if not exists (select 1 from public.citas_reservadas c join public.caja_movimientos m
      on m.movimiento_id = c.source_id where c.reserva_id = 'RES-QA-FICHA-016'
      and c.cliente_id = m.cliente_id and c.cliente = m.cliente and c.whatsapp = m.whatsapp
      and m.estado_boleta = 'No aplica' and m.numero_boleta is null) then
    raise exception 'La identidad o el estado de comprobante no quedó sincronizado';
  end if;

  insert into public.solicitudes_comprobante (
    solicitud_id, reserva_id, cliente_id, tipo_comprobante, tipo_documento,
    numero_documento, razon_social, estado
  ) values ('COMP-QA-016', 'RES-QA-COMP-016', v_cliente_id, 'FACTURA', 'RUC',
    '20123456789', 'Empresa QA SAC', 'PENDIENTE');
end;
$$;

-- Si todas las aserciones anteriores terminan sin error, inspeccionar si se
-- desea y ejecutar esta última sentencia para descartar absolutamente todo.
rollback;

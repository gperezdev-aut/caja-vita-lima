-- Validación manual posterior a 015 y 016. No ejecutar en producción sin
-- revisar los prefijos QA. Cada escritura queda descartada por ROLLBACK.
begin;

do $$
declare
  v_fecha date := (now() at time zone 'America/Lima')::date + 30;
  v_sede text;
  v_hora time;
  v_codigo_presencial text;
  v_precio_presencial numeric(12,2);
  v_duracion_presencial int;
  v_precio_dom numeric(12,2);
  v_duracion_dom int;
  v_payload_presencial jsonb;
  v_payload_domicilio jsonb;
  v_payload_factura jsonb;
  v_payload_codigo_directo jsonb;
  v_payload_pago jsonb;
  v_metodo_no_efectivo text;
  v_primero jsonb;
  v_reintento jsonb;
  v_cliente_presencial text;
  v_cliente_domicilio text;
  v_cliente_factura text;
begin
  if to_regclass('public.solicitudes_comprobante') is null then
    raise exception 'Falta solicitudes_comprobante';
  end if;

  -- Servicio presencial y sede donde cabe toda su duración.
  with catalogo as (
    select btrim(c."CodeId"::text) as codigo,
      case when nullif(btrim(to_jsonb(c)->>'price_pen'), '') is not null then
        nullif(replace(regexp_replace(to_jsonb(c)->>'price_pen', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric
      else
        nullif(replace(regexp_replace(to_jsonb(c)->>'price', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric
      end as precio,
      nullif(regexp_replace(c.duration_min::text, '[^0-9]', '', 'g'), '')::int as duracion
    from public.stg_services_catalog_v5 c
    where lower(coalesce(c.active::text, '')) in ('true','1','yes','si','sí')
      and btrim(c."CodeId"::text) not in ('DOM-1H', 'DOM-2H')
  )
  select c.codigo, c.precio, c.duracion, s.nombre, s.hora_apertura
  into v_codigo_presencial, v_precio_presencial, v_duracion_presencial, v_sede, v_hora
  from catalogo c cross join public.sedes s
  where c.precio > 0 and c.duracion > 0 and s.activo is true
    and s.hora_apertura is not null and s.hora_cierre is not null
    and s.hora_apertura + make_interval(mins => c.duracion) <= s.hora_cierre
  order by s.nombre, c.codigo
  limit 1;
  if v_codigo_presencial is null then
    raise exception 'No hay servicio presencial activo con precio/duración y sede válida';
  end if;

  -- DOM-1H tiene una sola fuente activa y el precio sigue price_pen → price.
  if (select count(*) from public.stg_services_catalog_v5 c
      where btrim(c."CodeId"::text) = 'DOM-1H'
        and lower(coalesce(c.active::text, '')) in ('true','1','yes','si','sí')) <> 1 then
    raise exception 'DOM-1H debe existir exactamente una vez y estar activo';
  end if;
  select
    case when nullif(btrim(to_jsonb(c)->>'price_pen'), '') is not null then
      nullif(replace(regexp_replace(to_jsonb(c)->>'price_pen', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric
    else
      nullif(replace(regexp_replace(to_jsonb(c)->>'price', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric
    end,
    nullif(regexp_replace(c.duration_min::text, '[^0-9]', '', 'g'), '')::int
  into v_precio_dom, v_duracion_dom
  from public.stg_services_catalog_v5 c
  where btrim(c."CodeId"::text) = 'DOM-1H'
    and lower(coalesce(c.active::text, '')) in ('true','1','yes','si','sí');
  if coalesce(v_precio_dom, 0) <= 0 or coalesce(v_duracion_dom, 0) <= 0 then
    raise exception 'DOM-1H no tiene precio o duración válidos';
  end if;
  if v_hora + make_interval(mins => greatest(v_duracion_presencial, v_duracion_dom)) >
     (select hora_cierre from public.sedes where nombre = v_sede) then
    raise exception 'La sede QA no cubre la duración de domicilio';
  end if;

  -- Creación presencial. token_expira reproduce exactamente prepararCitaAction:
  -- inicio + duración; la igualdad al final debe ser válida.
  v_payload_presencial := jsonb_build_object(
    'request_id', 'd9710c49-c6ae-45a4-8858-59e06d91f101',
    'canal', 'directo', 'personas', 1, 'fecha', v_fecha::text, 'hora', v_hora::text,
    'sede', v_sede, 'sede_operativa', v_sede, 'tipo_atencion', 'sede',
    'cliente', 'Cliente QA Presencial', 'whatsapp_e164', '+51900000101', 'pais_telefono', 'PE',
    'servicios', jsonb_build_array(jsonb_build_object('codigo', v_codigo_presencial)),
    'monto_total', 0.01, 'costo_movilidad', 999, -- no son fuente económica
    'monto_pagado', least(10::numeric, v_precio_presencial), 'metodo_pago', 'EFECTIVO',
    'cliente_id', 'CLI-QA-016-PRES', 'movimiento_id', 'MOV-QA-016-PRES',
    'reserva_id', 'RES-QA-016-PRES', 'pago_id', 'PAY-QA-016-PRES',
    'token', repeat('A', 43),
    'token_expira', (((v_fecha + v_hora) + make_interval(mins => v_duracion_presencial)) at time zone 'America/Lima')::text
  );
  v_primero := public.preparar_ficha_cita(v_payload_presencial);
  v_reintento := public.preparar_ficha_cita(v_payload_presencial);
  if v_primero->>'reserva_id' <> 'RES-QA-016-PRES'
     or v_primero->>'token' <> repeat('A', 43)
     or v_reintento->>'token' <> repeat('A', 43)
     or coalesce((v_reintento->>'reutilizado')::boolean, false) is not true then
    raise exception 'Falló expiración exacta o idempotencia presencial';
  end if;
  if (select count(*) from public.citas_reservadas where request_id = 'd9710c49-c6ae-45a4-8858-59e06d91f101') <> 1
     or (select count(*) from public.caja_movimientos where source_id = 'RES-QA-016-PRES') <> 1
     or (select count(*) from public.caja_pagos where movimiento_id = 'MOV-QA-016-PRES') <> 1 then
    raise exception 'El reintento presencial duplicó registros';
  end if;
  begin
    perform public.preparar_ficha_cita(v_payload_presencial || '{"cliente":"Payload distinto"}'::jsonb);
    raise exception 'Debió rechazar request_id con payload distinto';
  exception when sqlstate '23505' then
    if sqlerrm not like '%REQUEST_ID_PAYLOAD_CONFLICTO%' then raise; end if;
  end;
  if not exists (
    select 1 from public.caja_movimientos
    where movimiento_id = 'MOV-QA-016-PRES' and estado = 'Reservado'
      and monto_servicio = v_precio_presencial and total_extras = 0
      and total_cobrar = v_precio_presencial and total_pagado = least(10::numeric, v_precio_presencial)
  ) then raise exception 'Desglose o estado presencial incorrecto'; end if;

  -- Las reglas críticas de pago se prueban en la RPC, no solo en la UI.
  v_payload_pago := v_payload_presencial || jsonb_build_object(
    'request_id', 'd9710c49-c6ae-45a4-8858-59e06d91f105', 'movimiento_id', 'MOV-QA-016-PAGO-1',
    'reserva_id', 'RES-QA-016-PAGO-1', 'pago_id', 'PAY-QA-016-PAGO-1', 'token', repeat('E', 43), 'monto_pagado', -1
  );
  begin perform public.preparar_ficha_cita(v_payload_pago); raise exception 'Debió rechazar pago negativo';
  exception when sqlstate '22023' then if sqlerrm not like '%MONTO_PAGADO_NEGATIVO%' then raise; end if; end;
  v_payload_pago := v_payload_pago || jsonb_build_object(
    'request_id', 'd9710c49-c6ae-45a4-8858-59e06d91f106', 'movimiento_id', 'MOV-QA-016-PAGO-2',
    'reserva_id', 'RES-QA-016-PAGO-2', 'pago_id', 'PAY-QA-016-PAGO-2', 'token', repeat('F', 43), 'monto_pagado', 0
  );
  begin perform public.preparar_ficha_cita(v_payload_pago); raise exception 'Debió rechazar adelanto insuficiente';
  exception when sqlstate '22023' then if sqlerrm not like '%PAGO_INSUFICIENTE%' then raise; end if; end;
  v_payload_pago := v_payload_pago || jsonb_build_object(
    'request_id', 'd9710c49-c6ae-45a4-8858-59e06d91f107', 'movimiento_id', 'MOV-QA-016-PAGO-3',
    'reserva_id', 'RES-QA-016-PAGO-3', 'pago_id', 'PAY-QA-016-PAGO-3', 'token', repeat('G', 43), 'monto_pagado', v_precio_presencial + .01
  );
  begin perform public.preparar_ficha_cita(v_payload_pago); raise exception 'Debió rechazar pago mayor al total';
  exception when sqlstate '22023' then if sqlerrm not like '%MONTO_PAGADO_SUPERA_TOTAL%' then raise; end if; end;
  v_payload_pago := v_payload_pago || jsonb_build_object(
    'request_id', 'd9710c49-c6ae-45a4-8858-59e06d91f108', 'movimiento_id', 'MOV-QA-016-PAGO-4',
    'reserva_id', 'RES-QA-016-PAGO-4', 'pago_id', 'PAY-QA-016-PAGO-4', 'token', repeat('H', 43),
    'monto_pagado', least(10::numeric, v_precio_presencial), 'metodo_pago', ''
  );
  begin perform public.preparar_ficha_cita(v_payload_pago); raise exception 'Debió exigir método de pago';
  exception when sqlstate '22023' then if sqlerrm not like '%METODO_PAGO_REQUERIDO%' then raise; end if; end;
  v_payload_pago := v_payload_pago || jsonb_build_object(
    'request_id', 'd9710c49-c6ae-45a4-8858-59e06d91f109', 'movimiento_id', 'MOV-QA-016-PAGO-5',
    'reserva_id', 'RES-QA-016-PAGO-5', 'pago_id', 'PAY-QA-016-PAGO-5', 'token', repeat('I', 43), 'metodo_pago', 'NO_CONFIGURADO'
  );
  begin perform public.preparar_ficha_cita(v_payload_pago); raise exception 'Debió rechazar método no configurado';
  exception when sqlstate '22023' then if sqlerrm not like '%METODO_PAGO_NO_PERMITIDO%' then raise; end if; end;
  select upper(btrim(valor)) into v_metodo_no_efectivo from public.config_listas
    where lista = 'METODOS_PAGO' and activo is true and upper(btrim(valor)) <> 'EFECTIVO' limit 1;
  if v_metodo_no_efectivo is not null then
    v_payload_pago := v_payload_pago || jsonb_build_object(
      'request_id', 'd9710c49-c6ae-45a4-8858-59e06d91f110', 'movimiento_id', 'MOV-QA-016-PAGO-6',
      'reserva_id', 'RES-QA-016-PAGO-6', 'pago_id', 'PAY-QA-016-PAGO-6', 'token', repeat('J', 43),
      'metodo_pago', v_metodo_no_efectivo, 'numero_operacion', ''
    );
    begin perform public.preparar_ficha_cita(v_payload_pago); raise exception 'Debió exigir número de operación';
    exception when sqlstate '22023' then if sqlerrm not like '%NUMERO_OPERACION_REQUERIDO%' then raise; end if; end;
  end if;

  -- Domicilio: movilidad única, total del catálogo y estado pendiente.
  v_payload_domicilio := jsonb_build_object(
    'request_id', 'd9710c49-c6ae-45a4-8858-59e06d91f102',
    'canal', 'directo', 'personas', 1, 'fecha', v_fecha::text, 'hora', v_hora::text,
    'sede', v_sede, 'sede_operativa', v_sede, 'tipo_atencion', 'domicilio',
    'domicilio_distrito', 'Distrito QA', 'domicilio_direccion', 'Dirección QA 123',
    'domicilio_referencia', 'Referencia QA', 'cliente', 'Cliente QA Domicilio',
    'whatsapp_e164', '+51900000102', 'pais_telefono', 'PE',
    'servicios', jsonb_build_array(jsonb_build_object('codigo', 'DOM-1H')),
    'monto_total', 0.01, 'costo_movilidad', 999, -- se ignoran
    'monto_pagado', round((v_precio_dom + 15) * .5, 2), 'metodo_pago', 'EFECTIVO',
    'cliente_id', 'CLI-QA-016-DOM', 'movimiento_id', 'MOV-QA-016-DOM',
    'reserva_id', 'RES-QA-016-DOM', 'pago_id', 'PAY-QA-016-DOM',
    'token', repeat('B', 43),
    'token_expira', (((v_fecha + v_hora) + make_interval(mins => v_duracion_dom)) at time zone 'America/Lima')::text
  );
  perform public.preparar_ficha_cita(v_payload_domicilio);
  if not exists (
    select 1 from public.caja_movimientos
    where movimiento_id = 'MOV-QA-016-DOM' and estado = 'Pendiente de confirmación'
      and monto_servicio = v_precio_dom and total_extras = 15
      and total_cobrar = v_precio_dom + 15 and total_pagado = round((v_precio_dom + 15) * .5, 2)
      and pendiente = round((v_precio_dom + 15) * .5, 2)
  ) then raise exception 'Desglose, saldo o estado domicilio incorrecto'; end if;

  -- Una ficha omisa conserva datos y sincroniza cliente/cita/movimiento.
  select cliente_id into v_cliente_presencial from public.citas_reservadas where reserva_id = 'RES-QA-016-PRES';
  update public.clientes set email = 'anterior@example.com', dni = '12345678', cumple_dia = 14,
    cumple_mes = 3, consent_promos_en = '2026-01-01T00:00:00Z' where cliente_id = v_cliente_presencial;
  perform public.completar_ficha_cita(repeat('A', 43), jsonb_build_object(
    'cliente_id', v_cliente_presencial, 'nombre', 'Cliente QA Presencial Actualizado',
    'whatsapp_e164', '+51900000101', 'pais_telefono', 'PE', 'idioma', 'es',
    'consent_promos', false, 'guardar_salud', false, 'solicita_comprobante', false
  ));
  if not exists (select 1 from public.clientes where cliente_id = v_cliente_presencial
      and email = 'anterior@example.com' and dni = '12345678' and cumple_dia = 14 and cumple_mes = 3
      and consent_promos_en = '2026-01-01T00:00:00Z') then
    raise exception 'completar_ficha_cita borró datos previos';
  end if;
  if not exists (select 1 from public.citas_reservadas c join public.caja_movimientos m on m.movimiento_id = c.source_id
      where c.reserva_id = 'RES-QA-016-PRES' and c.cliente_id = m.cliente_id
        and c.cliente = m.cliente and c.whatsapp = m.whatsapp and m.estado_boleta = 'No aplica') then
    raise exception 'Cliente, cita y movimiento no quedaron sincronizados';
  end if;

  -- DNI a través de completar_ficha_cita crea BOLETA.
  select cliente_id into v_cliente_domicilio from public.citas_reservadas where reserva_id = 'RES-QA-016-DOM';
  perform public.completar_ficha_cita(repeat('B', 43), jsonb_build_object(
    'cliente_id', v_cliente_domicilio, 'nombre', 'Cliente QA Domicilio',
    'whatsapp_e164', '+51900000102', 'pais_telefono', 'PE', 'idioma', 'es',
    'consent_promos', false, 'guardar_salud', false, 'solicita_comprobante', true,
    'tipo_comprobante', 'BOLETA', 'tipo_documento', 'DNI', 'numero_documento', '87654321', 'razon_social', ''
  ));
  if not exists (select 1 from public.solicitudes_comprobante
      where reserva_id = 'RES-QA-016-DOM' and tipo_comprobante = 'BOLETA' and tipo_documento = 'DNI'
        and numero_documento = '87654321') then raise exception 'DNI no creó BOLETA'; end if;

  -- FACTURA/RUC por completar_ficha_cita, sin alterar clientes.dni.
  v_payload_factura := v_payload_presencial || jsonb_build_object(
    'request_id', 'd9710c49-c6ae-45a4-8858-59e06d91f103', 'cliente', 'Cliente QA Factura',
    'whatsapp_e164', '+51900000103', 'cliente_id', 'CLI-QA-016-RUC',
    'movimiento_id', 'MOV-QA-016-RUC', 'reserva_id', 'RES-QA-016-RUC', 'pago_id', 'PAY-QA-016-RUC',
    'token', repeat('C', 43)
  );
  perform public.preparar_ficha_cita(v_payload_factura);
  select cliente_id into v_cliente_factura from public.citas_reservadas where reserva_id = 'RES-QA-016-RUC';
  update public.clientes set dni = '11223344' where cliente_id = v_cliente_factura;
  perform public.completar_ficha_cita(repeat('C', 43), jsonb_build_object(
    'cliente_id', v_cliente_factura, 'nombre', 'Cliente QA Factura',
    'whatsapp_e164', '+51900000103', 'pais_telefono', 'PE', 'idioma', 'es',
    'consent_promos', false, 'guardar_salud', false, 'solicita_comprobante', true,
    'tipo_comprobante', 'FACTURA', 'tipo_documento', 'RUC', 'numero_documento', '20123456789', 'razon_social', 'Empresa QA SAC'
  ));
  if not exists (select 1 from public.solicitudes_comprobante where reserva_id = 'RES-QA-016-RUC'
      and tipo_comprobante = 'FACTURA' and tipo_documento = 'RUC' and razon_social = 'Empresa QA SAC')
     or not exists (select 1 from public.clientes where cliente_id = v_cliente_factura and dni = '11223344') then
    raise exception 'FACTURA/RUC no quedó aislada de clientes.dni';
  end if;

  -- Directo no admite codigoCupon y nunca inserta plataforma directo.
  v_payload_codigo_directo := v_payload_presencial || jsonb_build_object(
    'request_id', 'd9710c49-c6ae-45a4-8858-59e06d91f104', 'cliente', 'Cliente QA Código',
    'whatsapp_e164', '+51900000104', 'cliente_id', 'CLI-QA-016-COD',
    'movimiento_id', 'MOV-QA-016-COD', 'reserva_id', 'RES-QA-016-COD', 'pago_id', 'PAY-QA-016-COD',
    'token', repeat('D', 43)
  );
  perform public.preparar_ficha_cita(v_payload_codigo_directo);
  begin
    perform public.completar_ficha_cita(repeat('D', 43), jsonb_build_object(
      'cliente_id', 'CLI-QA-016-COD', 'nombre', 'Cliente QA Código',
      'whatsapp_e164', '+51900000104', 'pais_telefono', 'PE', 'codigo_cupon', 'NO-ADMITE',
      'consent_promos', false, 'guardar_salud', false, 'solicita_comprobante', false
    ));
    raise exception 'Canal directo debió rechazar codigo_cupon';
  exception when sqlstate '22023' then
    if sqlerrm not like '%CODIGO_CONVENIO_NO_PERMITIDO_DIRECTO%' then raise; end if;
  end;
  if exists (select 1 from public.cupones_convenios where reserva_id = 'RES-QA-016-COD' or plataforma = 'directo') then
    raise exception 'Se insertó un convenio directo';
  end if;

  -- Un WhatsApp de otro cliente no fusiona ni modifica la ficha.
  insert into public.clientes (cliente_id, cliente, whatsapp, whatsapp_e164, pais_telefono)
  values ('CLI-QA-016-OTRO', 'Cliente QA Otro', '+51900000999', '+51900000999', 'PE');
  begin
    perform public.completar_ficha_cita(repeat('D', 43), jsonb_build_object(
      'cliente_id', 'CLI-QA-016-COD', 'nombre', 'Cliente QA Código',
      'whatsapp_e164', '+51900000999', 'pais_telefono', 'PE',
      'consent_promos', false, 'guardar_salud', false, 'solicita_comprobante', false
    ));
    raise exception 'Debió rechazar teléfono asociado a otro cliente';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%TELEFONO_ASOCIADO_OTRO_CLIENTE%' then raise; end if;
  end;

  -- No hay secuencia nueva: solicitud_id es text. La tabla sensible solo
  -- queda disponible para service_role, nunca anon/authenticated.
  if not has_table_privilege('service_role', 'public.solicitudes_comprobante', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('anon', 'public.solicitudes_comprobante', 'SELECT')
     or has_table_privilege('authenticated', 'public.solicitudes_comprobante', 'SELECT') then
    raise exception 'Privilegios de solicitudes_comprobante incorrectos';
  end if;
end;
$$;

rollback;

-- Confirma que la transacción no dejó residuos.
do $$
begin
  if exists (select 1 from public.citas_reservadas where reserva_id like 'RES-QA-016-%')
     or exists (select 1 from public.caja_movimientos where movimiento_id like 'MOV-QA-016-%')
     or exists (select 1 from public.caja_pagos where pago_id like 'PAY-QA-016-%')
     or exists (select 1 from public.solicitudes_comprobante where solicitud_id like 'COMP-RES-QA-016-%')
     or exists (select 1 from public.clientes where cliente_id like 'CLI-QA-016-%') then
    raise exception 'Quedaron residuos QA después de ROLLBACK';
  end if;
end;
$$;

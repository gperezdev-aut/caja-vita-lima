begin;

do $$
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
  v_ahora time := (now() at time zone 'America/Lima')::time;
  v_payload jsonb;
  v_resultado jsonb;
  v_reintento jsonb;
  v_movimientos_antes integer;
  v_reservas_antes integer;
  v_clientes_antes integer;
  v_active_release text;
  v_active_release_count integer;
  v_one_service record;
  v_fixed_two_service record;
  v_home_service_1 record;
  v_home_service_2 record;
  v_one_service_json jsonb;
  v_fixed_two_service_json jsonb;
  v_home_services_json jsonb;
  v_personal_components jsonb;
begin
  -- Los fixtures usan exclusivamente códigos del snapshot canónico activo.
  select count(*), min(r.release_id)
    into v_active_release_count, v_active_release
  from public.caja_catalog_releases r
  where r.active is true;
  if v_active_release_count <> 1 then
    raise exception 'QA_022_EXPECTED_ONE_ACTIVE_CATALOG_RELEASE_FOUND_%', v_active_release_count;
  end if;

  select s.* into v_one_service
  from public.caja_catalog_services s
  where s.release_id = v_active_release and s.active is true
    and s.selection_rule = 'ONE_PERSON'
    and s.reservation_behavior = 'APPOINTMENT'
    and 1 between s.people_min and s.people_max
    and s.category <> 'HOME' and s.modality <> 'HOME'
  order by s.service_code
  limit 1;
  if not found then
    raise exception 'QA_022_CATALOG_ONE_PERSON_APPOINTMENT_MISSING';
  end if;

  select s.* into v_fixed_two_service
  from public.caja_catalog_services s
  where s.release_id = v_active_release and s.active is true
    and s.selection_rule = 'FIXED_TWO_PACKAGE'
    and s.reservation_behavior = 'APPOINTMENT'
    and s.people_min = 2 and s.people_max = 2
    and s.category <> 'HOME' and s.modality <> 'HOME'
  order by s.service_code
  limit 1;
  if not found then
    raise exception 'QA_022_CATALOG_FIXED_TWO_PACKAGE_APPOINTMENT_MISSING';
  end if;

  select s.* into v_home_service_1
  from public.caja_catalog_services s
  where s.release_id = v_active_release and s.active is true
    and s.selection_rule = 'HOME_FLOW'
    and s.reservation_behavior = 'HOME_APPOINTMENT'
    and 2 between s.people_min and s.people_max
    and (s.category = 'HOME' or s.modality = 'HOME')
  order by s.service_code
  limit 1;
  if not found then
    raise exception 'QA_022_CATALOG_HOME_2P_FIRST_SERVICE_MISSING';
  end if;

  select s.* into v_home_service_2
  from public.caja_catalog_services s
  where s.release_id = v_active_release and s.active is true
    and s.selection_rule = 'HOME_FLOW'
    and s.reservation_behavior = 'HOME_APPOINTMENT'
    and s.service_code <> v_home_service_1.service_code
    and 2 between s.people_min and s.people_max
    and (s.category = 'HOME' or s.modality = 'HOME')
  order by s.service_code
  limit 1;
  if not found then
    raise exception 'QA_022_CATALOG_HOME_2P_SECOND_SERVICE_MISSING';
  end if;

  v_one_service_json := jsonb_build_array(
    jsonb_build_object('codigo', v_one_service.service_code)
  );
  v_fixed_two_service_json := jsonb_build_array(
    jsonb_build_object('codigo', v_fixed_two_service.service_code)
  );
  v_home_services_json := jsonb_build_array(
    jsonb_build_object('codigo', v_home_service_1.service_code),
    jsonb_build_object('codigo', v_home_service_2.service_code)
  );
  v_personal_components := jsonb_build_array(
    jsonb_build_object(
      'persona', 1,
      'componentes', jsonb_build_array(
        jsonb_build_object(
          'tipo', 'catalogo', 'codigo', v_one_service.service_code,
          'nombre', v_one_service.name_es, 'precio', v_one_service.price_pen,
          'duracion_min', v_one_service.duration_min
        ),
        jsonb_build_object(
          'tipo', 'catalogo', 'codigo', v_one_service.service_code,
          'nombre', v_one_service.name_es, 'precio', v_one_service.price_pen,
          'duracion_min', v_one_service.duration_min
        )
      )
    ),
    jsonb_build_object(
      'persona', 2,
      'componentes', jsonb_build_array(
        jsonb_build_object(
          'tipo', 'catalogo', 'codigo', v_one_service.service_code,
          'nombre', v_one_service.name_es, 'precio', v_one_service.price_pen,
          'duracion_min', v_one_service.duration_min
        )
      )
    )
  );

  -- Fixtures mínimos: identidades y pares cruzados ya creados por Preparar cita.
  insert into public.clientes (cliente_id, cliente, whatsapp)
  values
    ('CLI-QA-022-A', 'QA 022 UNO', '900000221'),
    ('CLI-QA-022-B', 'QA 022 DOS', '900000222'),
    ('CLI-QA-022-C', 'QA 022 HOME', '900000223'),
    ('CLI-QA-022-H', 'QA 022 PARCIAL', '900000224'),
    ('CLI-QA-022-I', 'QA 022 PAGADO', '900000225'),
    ('CLI-QA-022-G', 'QA 022 RELACION', '900000226');

  insert into public.caja_movimientos (
    movimiento_id, fecha, hora, sede, tipo_movimiento, estado, cliente_id,
    cliente, whatsapp, n_pax, servicio, monto_servicio, total_extras,
    total_cobrar, total_pagado, pendiente, source_type, source_id,
    estado_boleta, tipo_comprobante, estado_comprobante_manual
  ) values
    ('MOV-QA-022-A', v_hoy, '10:00', 'Miraflores', 'RESERVA_APP', 'Reservado', 'CLI-QA-022-A', 'QA 022 UNO', '900000221', 1, v_one_service.name_es, 229, 0, 229, 115, 114, 'APP_CAJA_FICHA', 'RES-QA-022-A', 'Pendiente', 'BOLETA', 'PENDIENTE'),
    ('MOV-QA-022-B', v_hoy, '11:00', 'Miraflores', 'RESERVA_APP', 'Reservado', 'CLI-QA-022-B', 'QA 022 DOS', '900000222', 2, 'Atención personalizada', 300, 0, 300, 150, 150, 'APP_CAJA_FICHA', 'RES-QA-022-B', 'No aplica', 'NO_APLICA', 'NO_APLICA'),
    ('MOV-QA-022-C', v_hoy, '12:00', 'San Borja', 'RESERVA_APP', 'Reservado', 'CLI-QA-022-C', 'QA 022 HOME', '900000223', 2, v_home_service_1.name_es || ' + ' || v_home_service_2.name_es, 230, 30, 260, 130, 130, 'APP_CAJA_FICHA', 'RES-QA-022-C', 'No aplica', 'NO_APLICA', 'NO_APLICA'),
    ('MOV-QA-022-H', v_hoy, '13:00', 'Miraflores', 'RESERVA_APP', 'Reservado', 'CLI-QA-022-H', 'QA 022 PARCIAL', '900000224', 1, v_one_service.name_es, 150, 0, 150, 50, 100, 'APP_CAJA_FICHA', 'RES-QA-022-H', 'No aplica', 'NO_APLICA', 'NO_APLICA'),
    ('MOV-QA-022-I', v_hoy, '14:00', 'Miraflores', 'RESERVA_APP', 'Reservado', 'CLI-QA-022-I', 'QA 022 PAGADO', '900000225', 1, v_one_service.name_es, 100, 0, 100, 100, 0, 'APP_CAJA_FICHA', 'RES-QA-022-I', 'No aplica', 'NO_APLICA', 'NO_APLICA'),
    ('MOV-QA-022-G', v_hoy, '15:00', 'Miraflores', 'RESERVA_APP', 'Reservado', 'CLI-QA-022-G', 'QA 022 RELACION', '900000226', 2, v_fixed_two_service.name_es, 100, 0, 100, 10, 90, 'APP_CAJA_FICHA', 'RES-QA-022-OTRA', 'No aplica', 'NO_APLICA', 'NO_APLICA');

  insert into public.citas_reservadas (
    reserva_id, fecha_cita, hora_cita, sede, cliente_id, cliente, whatsapp,
    n_pax, personas, servicio, monto_total, adelanto, saldo_pendiente,
    estado, source, source_id, estado_ficha, requiere_confirmacion,
    tipo_atencion, sede_operativa, costo_movilidad, atencion_personalizada,
    componentes_por_persona, modalidad_ejecucion, disponibilidad_confirmada,
    servicios_json
  ) values
    ('RES-QA-022-A', v_hoy, '10:00', 'Miraflores', 'CLI-QA-022-A', 'QA 022 UNO', '900000221', 1, 1, v_one_service.name_es, 229, 115, 114, 'PENDIENTE', 'APP_CAJA_FICHA', 'MOV-QA-022-A', 'completa', false, 'sede', 'Miraflores', 0, false, null, null, false, v_one_service_json),
    ('RES-QA-022-B', v_hoy, '11:00', 'Miraflores', 'CLI-QA-022-B', 'QA 022 DOS', '900000222', 2, 2, 'Atención personalizada', 300, 150, 150, 'PENDIENTE', 'APP_CAJA_FICHA', 'MOV-QA-022-B', 'completa', false, 'sede', 'Miraflores', 0, true, v_personal_components, 'simultanea', true, null),
    ('RES-QA-022-C', v_hoy, '12:00', 'San Borja', 'CLI-QA-022-C', 'QA 022 HOME', '900000223', 2, 2, v_home_service_1.name_es || ' + ' || v_home_service_2.name_es, 260, 130, 130, 'PENDIENTE', 'APP_CAJA_FICHA', 'MOV-QA-022-C', 'pendiente', false, 'domicilio', 'San Borja', 30, false, null, null, false, v_home_services_json),
    ('RES-QA-022-H', v_hoy, '13:00', 'Miraflores', 'CLI-QA-022-H', 'QA 022 PARCIAL', '900000224', 1, 1, v_one_service.name_es, 150, 50, 100, 'PENDIENTE', 'APP_CAJA_FICHA', 'MOV-QA-022-H', 'pendiente', false, 'sede', 'Miraflores', 0, false, null, null, false, v_one_service_json),
    ('RES-QA-022-I', v_hoy, '14:00', 'Miraflores', 'CLI-QA-022-I', 'QA 022 PAGADO', '900000225', 1, 1, v_one_service.name_es, 100, 100, 0, 'PENDIENTE', 'APP_CAJA_FICHA', 'MOV-QA-022-I', 'completa', false, 'sede', 'Miraflores', 0, false, null, null, false, v_one_service_json),
    ('RES-QA-022-G', v_hoy, '15:00', 'Miraflores', 'CLI-QA-022-G', 'QA 022 RELACION', '900000226', 2, 2, v_fixed_two_service.name_es, 100, 10, 90, 'PENDIENTE', 'APP_CAJA_FICHA', 'MOV-QA-022-DISTINTO', 'pendiente', false, 'sede', 'Miraflores', 0, false, null, null, false, v_fixed_two_service_json);

  -- El trigger 020 debe enriquecer los códigos reales; el harness no inyecta
  -- release_id ni price_version por su cuenta.
  if jsonb_array_length((select servicios_json from public.citas_reservadas where reserva_id = 'RES-QA-022-A')) <> 1
     or jsonb_array_length((select servicios_json from public.citas_reservadas where reserva_id = 'RES-QA-022-C')) <> 2
     or jsonb_array_length((select servicios_json from public.citas_reservadas where reserva_id = 'RES-QA-022-H')) <> 1
     or jsonb_array_length((select servicios_json from public.citas_reservadas where reserva_id = 'RES-QA-022-I')) <> 1
     or jsonb_array_length((select servicios_json from public.citas_reservadas where reserva_id = 'RES-QA-022-G')) <> 1
     or exists (
       select 1
       from public.citas_reservadas c
       cross join lateral jsonb_array_elements(c.servicios_json) item
       where c.reserva_id in ('RES-QA-022-A', 'RES-QA-022-C', 'RES-QA-022-H', 'RES-QA-022-I', 'RES-QA-022-G')
         and (
           nullif(btrim(item->>'release_id'), '') is null
           or item->>'release_id' <> v_active_release
           or nullif(btrim(item->>'price_version'), '') is null
         )
     ) then
    raise exception 'QA_022_CANONICAL_SERVICE_METADATA_MISSING';
  end if;

  if (select servicios_json is distinct from componentes_por_persona
      from public.citas_reservadas where reserva_id = 'RES-QA-022-B')
     or (select count(*)
         from public.citas_reservadas c
         cross join lateral jsonb_array_elements(c.componentes_por_persona) persona
         cross join lateral jsonb_array_elements(persona->'componentes') component
         where c.reserva_id = 'RES-QA-022-B'
           and component->>'tipo' = 'catalogo') <> 3
     or exists (
       select 1
       from public.citas_reservadas c
       cross join lateral jsonb_array_elements(c.componentes_por_persona) persona
       cross join lateral jsonb_array_elements(persona->'componentes') component
       where c.reserva_id = 'RES-QA-022-B'
         and component->>'tipo' = 'catalogo'
         and (
           nullif(btrim(component->>'release_id'), '') is null
           or component->>'release_id' <> v_active_release
           or nullif(btrim(component->>'price_version'), '') is null
         )
     ) then
    raise exception 'QA_022_CANONICAL_PERSONALIZED_METADATA_MISSING';
  end if;

  insert into public.caja_pagos (
    pago_id, movimiento_id, fecha, hora, sede, tipo_pago, metodo, monto, concepto
  ) values
    ('PAY-QA-022-A-ADV', 'MOV-QA-022-A', v_hoy - 4, '09:00', 'Miraflores', 'ADELANTO_APP', 'YAPE', 115, 'Adelanto QA'),
    ('PAY-QA-022-B-ADV', 'MOV-QA-022-B', v_hoy - 2, '09:00', 'Miraflores', 'ADELANTO_APP', 'YAPE', 150, 'Adelanto QA'),
    ('PAY-QA-022-C-ADV', 'MOV-QA-022-C', v_hoy - 2, '09:00', 'San Borja', 'ADELANTO_APP', 'YAPE', 130, 'Adelanto QA'),
    ('PAY-QA-022-H-ADV', 'MOV-QA-022-H', v_hoy - 1, '09:00', 'Miraflores', 'ADELANTO_APP', 'EFECTIVO', 50, 'Adelanto QA'),
    ('PAY-QA-022-I-ADV', 'MOV-QA-022-I', v_hoy - 1, '09:00', 'Miraflores', 'ADELANTO_APP', 'EFECTIVO', 100, 'Pago completo QA'),
    ('PAY-QA-022-G-ADV', 'MOV-QA-022-G', v_hoy - 1, '09:00', 'Miraflores', 'ADELANTO_APP', 'EFECTIVO', 10, 'Adelanto QA');

  insert into public.caja_atencion_detalle (
    detalle_id, movimiento_id, fecha, sede, persona_n, terapista, servicio,
    duracion, monto_asignado
  ) values
    ('RES-QA-022-A-P1', 'MOV-QA-022-A', v_hoy, 'Miraflores', 1, 'Por asignar', v_one_service.name_es, v_one_service.duration_min || ' min', 229),
    ('RES-QA-022-B-C1', 'MOV-QA-022-B', v_hoy, 'Miraflores', 1, 'Por asignar', v_one_service.name_es, v_one_service.duration_min || ' min', 100),
    ('RES-QA-022-B-C2', 'MOV-QA-022-B', v_hoy, 'Miraflores', 1, 'Por asignar', v_one_service.name_es, v_one_service.duration_min || ' min', 100),
    ('RES-QA-022-B-C3', 'MOV-QA-022-B', v_hoy, 'Miraflores', 2, 'Por asignar', v_one_service.name_es, v_one_service.duration_min || ' min', 100),
    ('RES-QA-022-C-P1', 'MOV-QA-022-C', v_hoy, 'San Borja', 1, 'Por asignar', v_home_service_1.name_es, v_home_service_1.duration_min || ' min', 115),
    ('RES-QA-022-C-P2', 'MOV-QA-022-C', v_hoy, 'San Borja', 2, 'Por asignar', v_home_service_2.name_es, v_home_service_2.duration_min || ' min', 115),
    ('RES-QA-022-H-P1', 'MOV-QA-022-H', v_hoy, 'Miraflores', 1, 'Por asignar', v_one_service.name_es, v_one_service.duration_min || ' min', 150),
    ('RES-QA-022-I-P1', 'MOV-QA-022-I', v_hoy, 'Miraflores', 1, 'Por asignar', v_one_service.name_es, v_one_service.duration_min || ' min', 100),
    ('RES-QA-022-G-P1', 'MOV-QA-022-G', v_hoy, 'Miraflores', 1, 'Por asignar', v_fixed_two_service.name_es, v_fixed_two_service.duration_min || ' min', 50),
    ('RES-QA-022-G-P2', 'MOV-QA-022-G', v_hoy, 'Miraflores', 2, 'Por asignar', v_fixed_two_service.name_es, v_fixed_two_service.duration_min || ' min', 50);

  insert into public.solicitudes_comprobante (
    solicitud_id, reserva_id, cliente_id, tipo_comprobante, tipo_documento,
    numero_documento, estado
  ) values (
    'SOL-QA-022-A', 'RES-QA-022-A', 'CLI-QA-022-A', 'BOLETA', 'DNI',
    '12345678', 'PENDIENTE'
  );

  select count(*) into v_movimientos_antes from public.caja_movimientos where movimiento_id like 'MOV-QA-022-%';
  select count(*) into v_reservas_antes from public.citas_reservadas where reserva_id like 'RES-QA-022-%';
  select count(*) into v_clientes_antes from public.clientes where cliente_id like 'CLI-QA-022-%';

  -- Caso A + D + J: 1P, adelanto en día anterior y saldo completo hoy.
  v_payload := jsonb_build_object(
    'request_id', 'a2200000-0000-4000-8000-000000000001',
    'movimiento_id', 'MOV-QA-022-A', 'reserva_id', 'RES-QA-022-A',
    'terapistas', jsonb_build_array(jsonb_build_object('persona', 1, 'terapista', 'Rossana')),
    'pago_restante', 114, 'metodo_pago', 'YAPE',
    'numero_operacion', 'QA-022-FINAL', 'extras', '[]'::jsonb,
    'observacion', 'Cierre QA', 'responsable', 'Gerald'
  );
  v_resultado := public.iniciar_o_cerrar_atencion_reservada_v1(v_payload);
  if (v_resultado->>'completada')::boolean is not true
     or (select tipo_movimiento from public.caja_movimientos where movimiento_id = 'MOV-QA-022-A') <> 'ATENCION_APP'
     or (select estado from public.caja_movimientos where movimiento_id = 'MOV-QA-022-A') <> 'Atendido'
     or (select estado from public.citas_reservadas where reserva_id = 'RES-QA-022-A') <> 'ATENDIDA_APP'
     or (select total_pagado from public.caja_movimientos where movimiento_id = 'MOV-QA-022-A') <> 229
     or (select pendiente from public.caja_movimientos where movimiento_id = 'MOV-QA-022-A') <> 0 then
    raise exception 'QA_022_CASE_A_COMPLETE';
  end if;
  if (select count(*) from public.caja_pagos where movimiento_id = 'MOV-QA-022-A') <> 2
     or (select coalesce(sum(monto), 0) from public.caja_pagos where movimiento_id = 'MOV-QA-022-A') <> 229 then
    raise exception 'QA_022_CASE_D_ADVANCE_PLUS_FINAL';
  end if;
  if not exists (
    select 1 from public.caja_pagos
    where movimiento_id = 'MOV-QA-022-A' and tipo_pago = 'SALDO_ATENCION_APP'
      and monto = 114 and fecha = v_hoy and hora >= v_ahora
  ) or not exists (
    select 1 from public.caja_pagos
    where pago_id = 'PAY-QA-022-A-ADV' and monto = 115 and fecha = v_hoy - 4
  ) then raise exception 'QA_022_CASE_J_REAL_PAYMENT_DATE'; end if;

  -- Caso E: mismo request/payload no duplica pago, detalle ni observación.
  v_reintento := public.iniciar_o_cerrar_atencion_reservada_v1(v_payload);
  if (v_reintento->>'reutilizado')::boolean is not true
     or (select count(*) from public.caja_pagos where movimiento_id = 'MOV-QA-022-A') <> 2
     or (select count(*) from public.caja_atencion_detalle where movimiento_id = 'MOV-QA-022-A') <> 1 then
    raise exception 'QA_022_CASE_E_IDEMPOTENCY';
  end if;

  -- Caso F: mismo request_id con payload distinto falla cerrado.
  begin
    perform public.iniciar_o_cerrar_atencion_reservada_v1(v_payload || jsonb_build_object('observacion', 'distinta'));
    raise exception 'QA_022_CASE_F_DID_NOT_FAIL';
  exception when unique_violation then null;
  end;

  -- Caso B: 2P y atención personalizada conserva componentes, asigna por persona.
  perform public.iniciar_o_cerrar_atencion_reservada_v1(jsonb_build_object(
    'request_id', 'a2200000-0000-4000-8000-000000000002',
    'movimiento_id', 'MOV-QA-022-B', 'reserva_id', 'RES-QA-022-B',
    'terapistas', jsonb_build_array(
      jsonb_build_object('persona', 1, 'terapista', 'Rossana'),
      jsonb_build_object('persona', 2, 'terapista', 'Melissa')
    ), 'pago_restante', 150, 'metodo_pago', 'EFECTIVO', 'extras', '[]'::jsonb,
    'responsable', 'Gerald'
  ));
  if (select count(*) from public.caja_atencion_detalle where movimiento_id = 'MOV-QA-022-B') <> 3
     or (select count(*) from public.caja_atencion_detalle where movimiento_id = 'MOV-QA-022-B' and persona_n = 1 and terapista = 'Rossana') <> 2
     or (select count(*) from public.caja_atencion_detalle where movimiento_id = 'MOV-QA-022-B' and persona_n = 2 and terapista = 'Melissa') <> 1
     or jsonb_array_length((select componentes_por_persona from public.citas_reservadas where reserva_id = 'RES-QA-022-B')) <> 2 then
    raise exception 'QA_022_CASE_B_PERSONALIZED_TWO_THERAPISTS';
  end if;

  -- Caso C: HOME 2P conserva movilidad/total y asigna una terapista por persona.
  perform public.iniciar_o_cerrar_atencion_reservada_v1(jsonb_build_object(
    'request_id', 'a2200000-0000-4000-8000-000000000003',
    'movimiento_id', 'MOV-QA-022-C', 'reserva_id', 'RES-QA-022-C',
    'terapistas', jsonb_build_array(
      jsonb_build_object('persona', 1, 'terapista', 'Cecilia'),
      jsonb_build_object('persona', 2, 'terapista', 'Lucia')
    ), 'pago_restante', 130, 'metodo_pago', 'YAPE',
    'numero_operacion', 'QA-HOME', 'extras', '[]'::jsonb,
    'responsable', 'Gerald'
  ));
  if (select total_extras from public.caja_movimientos where movimiento_id = 'MOV-QA-022-C') <> 30
     or (select total_cobrar from public.caja_movimientos where movimiento_id = 'MOV-QA-022-C') <> 260
     or (select count(distinct terapista) from public.caja_atencion_detalle where movimiento_id = 'MOV-QA-022-C') <> 2 then
    raise exception 'QA_022_CASE_C_HOME';
  end if;

  -- Caso G: IDs no relacionados fallan y no mutan.
  begin
    perform public.iniciar_o_cerrar_atencion_reservada_v1(jsonb_build_object(
      'request_id', 'a2200000-0000-4000-8000-000000000007',
      'movimiento_id', 'MOV-QA-022-G', 'reserva_id', 'RES-QA-022-G',
      'terapistas', jsonb_build_array(jsonb_build_object('persona', 1, 'terapista', 'Rossana')),
      'pago_restante', 90, 'metodo_pago', 'EFECTIVO', 'extras', '[]'::jsonb,
      'responsable', 'Gerald'
    ));
    raise exception 'QA_022_CASE_G_DID_NOT_FAIL';
  exception when check_violation then null;
  end;
  if (select tipo_movimiento from public.caja_movimientos where movimiento_id = 'MOV-QA-022-G') <> 'RESERVA_APP' then
    raise exception 'QA_022_CASE_G_MUTATED';
  end if;

  -- Caso H: pago parcial deja la atención abierta y saldo sincronizado.
  perform public.iniciar_o_cerrar_atencion_reservada_v1(jsonb_build_object(
    'request_id', 'a2200000-0000-4000-8000-000000000008',
    'movimiento_id', 'MOV-QA-022-H', 'reserva_id', 'RES-QA-022-H',
    'terapistas', jsonb_build_array(jsonb_build_object('persona', 1, 'terapista', 'Rossana')),
    'pago_restante', 20, 'metodo_pago', 'EFECTIVO', 'extras', '[]'::jsonb,
    'responsable', 'Gerald'
  ));
  if (select estado from public.caja_movimientos where movimiento_id = 'MOV-QA-022-H') <> 'En atención'
     or (select estado from public.citas_reservadas where reserva_id = 'RES-QA-022-H') <> 'EN_ATENCION'
     or (select pendiente from public.caja_movimientos where movimiento_id = 'MOV-QA-022-H') <> 80
     or (select saldo_pendiente from public.citas_reservadas where reserva_id = 'RES-QA-022-H') <> 80 then
    raise exception 'QA_022_CASE_H_PENDING';
  end if;

  -- Caso I: ya pagada, monto cero; cierra sin crear pago innecesario.
  perform public.iniciar_o_cerrar_atencion_reservada_v1(jsonb_build_object(
    'request_id', 'a2200000-0000-4000-8000-000000000009',
    'movimiento_id', 'MOV-QA-022-I', 'reserva_id', 'RES-QA-022-I',
    'terapistas', jsonb_build_array(jsonb_build_object('persona', 1, 'terapista', 'Rossana')),
    'pago_restante', 0, 'metodo_pago', '', 'extras', '[]'::jsonb,
    'responsable', 'Gerald'
  ));
  if (select count(*) from public.caja_pagos where movimiento_id = 'MOV-QA-022-I') <> 1
     or (select estado from public.caja_movimientos where movimiento_id = 'MOV-QA-022-I') <> 'Atendido' then
    raise exception 'QA_022_CASE_I_ZERO_PAYMENT';
  end if;

  -- No duplica identidad ni operación.
  if (select count(*) from public.caja_movimientos where movimiento_id like 'MOV-QA-022-%') <> v_movimientos_antes
     or (select count(*) from public.citas_reservadas where reserva_id like 'RES-QA-022-%') <> v_reservas_antes
     or (select count(*) from public.clientes where cliente_id like 'CLI-QA-022-%') <> v_clientes_antes then
    raise exception 'QA_022_DUPLICATED_IDENTITY_OR_OPERATION';
  end if;

  -- Comprobante/ficha/cliente quedan intactos.
  if (select estado_ficha from public.citas_reservadas where reserva_id = 'RES-QA-022-A') <> 'completa'
     or (select estado from public.solicitudes_comprobante where reserva_id = 'RES-QA-022-A') <> 'PENDIENTE'
     or (select estado_comprobante_manual from public.caja_movimientos where movimiento_id = 'MOV-QA-022-A') <> 'PENDIENTE'
     or (select cliente_id from public.caja_movimientos where movimiento_id = 'MOV-QA-022-A') <> 'CLI-QA-022-A' then
    raise exception 'QA_022_PRESERVATION';
  end if;

  -- Caso K: acumulado operativo conciliado con SUM(caja_pagos.monto).
  if exists (
    select 1 from public.caja_movimientos m
    where m.movimiento_id like 'MOV-QA-022-%'
      and m.total_pagado is distinct from (
        select coalesce(sum(p.monto), 0) from public.caja_pagos p
        where p.movimiento_id = m.movimiento_id
      )
  ) then raise exception 'QA_022_CASE_K_LEDGER_RECONCILIATION'; end if;

  if exists (
       select 1
       from pg_proc p
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where p.oid = 'public.iniciar_o_cerrar_atencion_reservada_v1(jsonb)'::regprocedure
         and a.grantee = 0 and a.privilege_type = 'EXECUTE'
     )
     or has_function_privilege('anon', 'public.iniciar_o_cerrar_atencion_reservada_v1(jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.iniciar_o_cerrar_atencion_reservada_v1(jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.iniciar_o_cerrar_atencion_reservada_v1(jsonb)', 'EXECUTE') then
    raise exception 'QA_022_RPC_PRIVILEGES';
  end if;
end;
$$;

rollback;

begin;

do $$
declare
  v_release text;
  v_result jsonb;
  v_home jsonb;
  v_package text;
  v_one_1 text;
  v_one_2 text;
begin
  if to_regprocedure('public.preparar_ficha_cita(jsonb)') is null then
    raise exception 'QA_020_PREPARAR_FICHA_MISSING';
  end if;
  if to_regprocedure('public.preparar_atencion_personalizada(jsonb)') is null then
    raise exception 'QA_020_PREPARAR_PERSONALIZADA_MISSING';
  end if;
  select release_id into v_release from public.caja_catalog_releases where active;
  if v_release is null then raise exception 'QA_020_ACTIVE_RELEASE_MISSING'; end if;
  if (select count(*) from public.caja_catalog_active_services_read_v1()) <> 50 then
    raise exception 'QA_020_EXPECTED_50_SERVICES';
  end if;
  if exists (
    select 1 from public.caja_catalog_active_services_read_v1() s
    where s.release_id <> v_release or s.price_pen <= 0 or s.duration_min <= 0
  ) then raise exception 'QA_020_ACTIVE_SERVICE_INVALID'; end if;
  if (select count(*) from public.caja_catalog_home_policy_read_v1()) <> 6 then
    raise exception 'QA_020_EXPECTED_6_HOME_RULES';
  end if;

  select service_code into v_package
  from public.caja_catalog_active_services_read_v1()
  where selection_rule = 'FIXED_TWO_PACKAGE' and reservation_behavior = 'APPOINTMENT'
  order by service_code limit 1;
  select min(service_code), max(service_code) into v_one_1, v_one_2
  from public.caja_catalog_active_services_read_v1()
  where selection_rule = 'ONE_PERSON' and reservation_behavior = 'APPOINTMENT';
  if v_package is null or v_one_1 is null or v_one_2 is null or v_one_1 = v_one_2 then
    raise exception 'QA_020_SELECTION_FIXTURES_MISSING';
  end if;
  v_result := public.caja_catalog_resolve_appointment_v1(jsonb_build_array(v_package), 2, null);
  if jsonb_array_length(v_result->'services') <> 1 then raise exception 'QA_020_PACKAGE_TWO_INVALID'; end if;
  v_result := public.caja_catalog_resolve_appointment_v1(jsonb_build_array(v_one_1, v_one_2), 2, null);
  if jsonb_array_length(v_result->'services') <> 2 then raise exception 'QA_020_ONE_PERSON_X2_INVALID'; end if;

  v_home := public.caja_catalog_resolve_appointment_v1('["SVC_008"]', 1, 'Miraflores');
  if (v_home->>'mobility_fee')::numeric <> 0 then raise exception 'QA_020_MIRAFLORES'; end if;
  v_home := public.caja_catalog_resolve_appointment_v1('["SVC_008","SVC_009"]', 2, 'Miraflores');
  if jsonb_array_length(v_home->'services') <> 2 or (v_home->>'mobility_fee')::numeric <> 0 then
    raise exception 'QA_020_HOME_TWO_PEOPLE_INVALID';
  end if;
  foreach v_result in array array[
    public.caja_catalog_resolve_appointment_v1('["SVC_008"]', 1, 'San Borja'),
    public.caja_catalog_resolve_appointment_v1('["SVC_008"]', 1, 'Surco'),
    public.caja_catalog_resolve_appointment_v1('["SVC_008"]', 1, 'San Isidro'),
    public.caja_catalog_resolve_appointment_v1('["SVC_008"]', 1, 'Barranco')
  ] loop
    if (v_result->>'mobility_fee')::numeric <> 30 then raise exception 'QA_020_FIXED_HOME_FEE'; end if;
    if (v_result->>'total')::numeric <> (v_result->>'subtotal')::numeric + 30 then raise exception 'QA_020_FEE_PER_APPOINTMENT'; end if;
  end loop;
  v_home := public.caja_catalog_resolve_appointment_v1('["SVC_008"]', 1, 'Distrito no configurado');
  if v_home->'mobility_fee' <> 'null'::jsonb or v_home->'total' <> 'null'::jsonb
     or (v_home->>'requires_confirmation')::boolean is not true then
    raise exception 'QA_020_DEFAULT_MUST_CONFIRM';
  end if;
  begin
    perform public.caja_catalog_resolve_appointment_v1(jsonb_build_array('SVC_008', v_one_1), 2, 'Miraflores');
    raise exception 'QA_020_HOME_BRANCH_MIX_SHOULD_FAIL';
  exception when raise_exception then
    if sqlerrm <> 'CAJA_APPOINTMENT_SERVICE_INVALID' then raise; end if;
  end;
  begin
    perform public.preparar_ficha_cita(jsonb_build_object(
      'request_id', 'a2000000-0000-4000-8000-000000000001',
      'canal', 'directo', 'personas', 1, 'cliente', 'QA HOME DEFAULT',
      'fecha', ((now() at time zone 'America/Lima')::date + 1)::text,
      'hora', '12:00', 'whatsapp_e164', '+51999999991', 'pais_telefono', 'PE',
      'tipo_atencion', 'domicilio', 'domicilio_distrito', 'Distrito no configurado',
      'domicilio_direccion', 'QA 123',
      'servicios', jsonb_build_array(jsonb_build_object('codigo', 'SVC_008'))
    ));
    raise exception 'QA_020_DEFAULT_RPC_SHOULD_FAIL';
  exception when raise_exception then
    if sqlerrm <> 'MOVILIDAD_HOME_REQUIERE_CONFIRMACION_MANUAL' then raise; end if;
  end;
  begin
    perform set_config('app.caja_catalog_snapshot_activation', v_release, true);
    update public.caja_catalog_releases set active = false where release_id = v_release;
    perform public.caja_catalog_resolve_appointment_v1(jsonb_build_array(v_one_1), 1, null);
    raise exception 'QA_020_INACTIVE_SNAPSHOT_SHOULD_FAIL';
  exception when raise_exception then
    if sqlerrm <> 'CAJA_CATALOG_ACTIVE_RELEASE_MISSING' then raise; end if;
  end;
  begin
    insert into public.caja_catalog_services (
      release_id, service_code, slug, name_es, name_en, included_es, included_en,
      category, commercial_group, modality, duration_min, people_rule_status,
      people_min, people_max, selection_rule, reservation_behavior,
      component_eligible, component_eligibility_status, active, price_pen,
      previous_price_pen, valid_from, valid_to, price_version
    )
    select release_id, 'SVC_999', 'qa-invalid-extra-service', 'QA invalid', name_en,
      included_es, included_en, category, commercial_group, modality, duration_min,
      people_rule_status, people_min, people_max, selection_rule,
      reservation_behavior, component_eligible, component_eligibility_status,
      active, price_pen, previous_price_pen, valid_from, valid_to, price_version
    from public.caja_catalog_services
    where release_id = v_release
    order by service_code limit 1;
    perform public.caja_catalog_resolve_appointment_v1(jsonb_build_array(v_one_1), 1, null);
    raise exception 'QA_020_INVALID_SNAPSHOT_SHOULD_FAIL';
  exception when raise_exception then
    if sqlerrm <> 'CAJA_CATALOG_ACTIVE_SNAPSHOT_INVALID' then raise; end if;
  end;

  if has_function_privilege('anon', 'public.caja_catalog_active_services_read_v1()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.caja_catalog_active_services_read_v1()', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.caja_catalog_active_services_read_v1()', 'EXECUTE') then
    raise exception 'QA_020_READ_PRIVILEGES';
  end if;
  if pg_get_functiondef('public.preparar_ficha_cita(jsonb)'::regprocedure) like '%stg_services_catalog_v5%'
     or pg_get_functiondef('public.preparar_ficha_cita(jsonb)'::regprocedure) like '%DOM-1H%'
     or pg_get_functiondef('public.preparar_ficha_cita(jsonb)'::regprocedure) like '%v_movilidad := 15%'
     or pg_get_functiondef('public.preparar_atencion_personalizada(jsonb)'::regprocedure) like '%stg_services_catalog_v5%' then
    raise exception 'QA_020_RPC_LEGACY_DEPENDENCY_REMAINS';
  end if;
end;
$$;

rollback;

begin;

do $$
declare
  v_release text;
  v_result jsonb;
  v_home jsonb;
begin
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

  v_home := public.caja_catalog_resolve_appointment_v1('["SVC_008"]', 1, 'Miraflores');
  if (v_home->>'mobility_fee')::numeric <> 0 then raise exception 'QA_020_MIRAFLORES'; end if;
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

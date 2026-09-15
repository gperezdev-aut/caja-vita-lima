-- Fixture exclusivo de QA para contratos PostgreSQL aislados.
-- Crea un snapshot canónico activo mínimo/representativo usando la RPC oficial.
-- No se usa en producción ni modifica Supabase remoto.

do $$
declare
  v_release_id constant text := 'catalog-v1-web-4104385';
  v_release jsonb := jsonb_build_object(
    'release_id', v_release_id,
    'source_web_sha', repeat('a', 40),
    'source_path', 'content/services.ts',
    'source_snapshot_sha256', repeat('b', 64),
    'expected_service_count', 50
  );
  v_home_manifest jsonb := jsonb_build_object(
    'release_id', v_release_id,
    'policy_id', 'HOME_MOBILITY_V1',
    'policy_sha256', 'c94adc0adb80f56af291221a4363a4ddcd319790af73b64e2c9a42f69dee9bf1',
    'charge_scope', 'PER_APPOINTMENT',
    'active', true
  );
  v_home_rules jsonb := jsonb_build_array(
    jsonb_build_object('scope','DISTRICT','district_code','MIRAFLORES','district_name','Miraflores','district_normalized','MIRAFLORES','pricing_mode','INCLUDED','fee_pen',0,'requires_confirmation',false),
    jsonb_build_object('scope','DISTRICT','district_code','SAN_BORJA','district_name','San Borja','district_normalized','SAN BORJA','pricing_mode','FIXED','fee_pen',30,'requires_confirmation',false),
    jsonb_build_object('scope','DISTRICT','district_code','SURCO','district_name','Surco','district_normalized','SURCO','pricing_mode','FIXED','fee_pen',30,'requires_confirmation',false),
    jsonb_build_object('scope','DISTRICT','district_code','SAN_ISIDRO','district_name','San Isidro','district_normalized','SAN ISIDRO','pricing_mode','FIXED','fee_pen',30,'requires_confirmation',false),
    jsonb_build_object('scope','DISTRICT','district_code','BARRANCO','district_name','Barranco','district_normalized','BARRANCO','pricing_mode','FIXED','fee_pen',30,'requires_confirmation',false),
    jsonb_build_object('scope','DEFAULT','district_code',null,'district_name',null,'district_normalized',null,'pricing_mode','MANUAL_CONFIRMATION','fee_pen',null,'requires_confirmation',true)
  );
  v_services jsonb;
begin
  select jsonb_agg(
    jsonb_build_object(
      'release_id', v_release_id,
      'service_code', 'SVC_' || lpad(n::text, 3, '0'),
      'slug', 'qa-' || n,
      'name_es', 'QA Servicio ' || n,
      'name_en', null,
      'included_es', 'Incluido QA',
      'included_en', null,
      'category', case
        when n in (8, 9) then 'HOME'
        when n <= 7 or n between 10 and 25 then 'INDIVIDUAL'
        when n between 26 and 39 then 'PACKAGE_TWO'
        when n <= 43 then 'PROGRAM'
        when n <= 46 then 'BEAUTY'
        else 'FACIAL'
      end,
      'commercial_group', null,
      'modality', case when n in (8, 9) then 'HOME' else 'SEDE' end,
      'duration_min', 60,
      'people_rule_status', 'CONFIRMED',
      'people_min', case when n between 26 and 39 then 2 else 1 end,
      'people_max', case when n in (8, 9) or n between 26 and 39 then 2 else 1 end,
      'selection_rule', case
        when n in (8, 9) then 'HOME_FLOW'
        when n between 26 and 39 then 'FIXED_TWO_PACKAGE'
        else 'ONE_PERSON'
      end,
      'reservation_behavior', case when n in (8, 9) then 'HOME_APPOINTMENT' else 'APPOINTMENT' end,
      'component_eligible', case when n in (8, 9) then false else true end,
      'component_eligibility_status', 'PENDING_REVIEW',
      'active', true,
      'price_pen', case when n = 1 then 120 when n = 16 then 70 when n between 26 and 39 then 200 else 100 end,
      'previous_price_pen', null,
      'price_version', v_release_id,
      'valid_from', '2026-09-01T00:00:00+00:00',
      'valid_to', null
    )
    order by n
  ) into v_services
  from generate_series(1, 50) n;

  perform public.caja_import_catalog_snapshot_v1(
    v_release,
    v_services,
    v_home_manifest,
    v_home_rules
  );
end;
$$;

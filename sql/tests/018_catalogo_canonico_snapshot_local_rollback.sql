-- Harness 018: ejecutar solo autorizado; todos los datos QA se revierten.
begin;
do $$
declare
  r jsonb := jsonb_build_object('release_id','catalog-v1-web-4104385','source_web_sha',repeat('a',40),'source_path','content/services.ts','source_snapshot_sha256',repeat('b',64),'expected_service_count',50);
  s jsonb; h jsonb := jsonb_build_object('release_id','catalog-v1-web-4104385','policy_id','HOME_MOBILITY_V1','policy_sha256','c94adc0adb80f56af291221a4363a4ddcd319790af73b64e2c9a42f69dee9bf1','charge_scope','PER_APPOINTMENT','active',true);
  rules jsonb := jsonb_build_array(jsonb_build_object('scope','DISTRICT','district_code','MIRAFLORES','district_name','Miraflores','district_normalized','MIRAFLORES','pricing_mode','INCLUDED','fee_pen',0,'requires_confirmation',false),jsonb_build_object('scope','DISTRICT','district_code','SAN_BORJA','district_name','San Borja','district_normalized','SAN BORJA','pricing_mode','FIXED','fee_pen',30,'requires_confirmation',false),jsonb_build_object('scope','DISTRICT','district_code','SURCO','district_name','Surco','district_normalized','SURCO','pricing_mode','FIXED','fee_pen',30,'requires_confirmation',false),jsonb_build_object('scope','DISTRICT','district_code','SAN_ISIDRO','district_name','San Isidro','district_normalized','SAN ISIDRO','pricing_mode','FIXED','fee_pen',30,'requires_confirmation',false),jsonb_build_object('scope','DISTRICT','district_code','BARRANCO','district_name','Barranco','district_normalized','BARRANCO','pricing_mode','FIXED','fee_pen',30,'requires_confirmation',false),jsonb_build_object('scope','DEFAULT','district_code',null,'district_name',null,'district_normalized',null,'pricing_mode','MANUAL_CONFIRMATION','fee_pen',null,'requires_confirmation',true));
  bad jsonb; code text;
begin
  select jsonb_agg(jsonb_build_object('release_id','catalog-v1-web-4104385','service_code','SVC_'||lpad(n::text,3,'0'),'slug','qa-'||n,'name_es','QA '||n,'name_en',null,'included_es',null,'included_en',null,'category',case when n<=23 then 'INDIVIDUAL' when n<=37 then 'PACKAGE_TWO' when n<=39 then 'HOME' when n<=43 then 'PROGRAM' when n<=46 then 'BEAUTY' else 'FACIAL' end,'commercial_group',null,'modality','QA','duration_min',60,'people_rule_status','CONFIRMED','people_min',case when n between 24 and 37 then 2 else 1 end,'people_max',case when n between 24 and 37 or n in (8,9) then 2 else 1 end,'selection_rule',case when n in (8,9) then 'HOME_FLOW' else 'QA' end,'reservation_behavior',case when n in (8,9) then 'HOME_APPOINTMENT' else 'QA' end,'component_eligible',null,'component_eligibility_status','PENDING_REVIEW','active',true,'price_pen',100,'previous_price_pen',null,'effective_from','2026-09-01T00:00:00+00:00','effective_to',null) order by n) into s from generate_series(1,50) n;
  perform public.caja_import_catalog_snapshot_v1(r,s,h,rules);
  perform public.caja_import_catalog_snapshot_v1(r,s,h,rules); -- idempotente
  if (select count(*) from public.caja_catalog_services where release_id='catalog-v1-web-4104385')<>50 or (select count(*) from public.caja_catalog_home_policy where release_id='catalog-v1-web-4104385')<>6 then raise exception 'QA_018_IMPORT_OR_IDEMPOTENCIA'; end if;
  for bad, code in
    select cases.bad, cases.code
    from (
      values
        ((s - 0)::jsonb, 'CAJA_CATALOG_SERVICE_COUNT_INVALID'::text),
        ((s || jsonb_build_array(s -> 0))::jsonb, 'CAJA_CATALOG_SERVICE_COUNT_INVALID'::text),
        (jsonb_set(s, '{1,service_code}', '"SVC_001"')::jsonb, 'CAJA_CATALOG_SERVICES_INVALID'::text),
        (jsonb_set(s, '{0,price_pen}', '0')::jsonb, 'CAJA_CATALOG_SERVICES_INVALID'::text),
        (jsonb_set(s, '{0,duration_min}', '0')::jsonb, 'CAJA_CATALOG_SERVICES_INVALID'::text),
        (jsonb_set(s, '{0,category}', '"HOME"')::jsonb, 'CAJA_CATALOG_SERVICES_INVALID'::text)
    ) as cases(bad, code)
  loop
    begin
      perform public.caja_import_catalog_snapshot_v1(r, bad, h, rules);
      raise exception 'QA_018_DEBIO_RECHAZAR';
    exception when raise_exception then
      if sqlerrm <> code then raise; end if;
    end;
  end loop;
  for bad, code in
    select cases.bad, cases.code
    from (
      values
        ((rules - 0)::jsonb, 'CAJA_CATALOG_HOME_MANIFEST_INVALID'::text),
        ((rules || jsonb_build_array(rules -> 0))::jsonb, 'CAJA_CATALOG_HOME_MANIFEST_INVALID'::text),
        (jsonb_set(rules, '{0,district_code}', '"MIRAFLORES_X"')::jsonb, 'CAJA_CATALOG_HOME_RULES_INVALID'::text),
        (jsonb_set(rules, '{0,district_name}', '"Miraflores X"')::jsonb, 'CAJA_CATALOG_HOME_RULES_INVALID'::text),
        (jsonb_set(rules, '{0,district_normalized}', '"MIRAFLORES X"')::jsonb, 'CAJA_CATALOG_HOME_RULES_INVALID'::text),
        (jsonb_set(rules, '{0,scope}', '"DEFAULT"')::jsonb, 'CAJA_CATALOG_HOME_RULES_INVALID'::text),
        (jsonb_set(rules, '{1,fee_pen}', '31')::jsonb, 'CAJA_CATALOG_HOME_RULES_INVALID'::text),
        (jsonb_set(rules, '{0,requires_confirmation}', 'true')::jsonb, 'CAJA_CATALOG_HOME_RULES_INVALID'::text),
        (jsonb_set(rules, '{5,district_code}', '"DEFAULT_X"')::jsonb, 'CAJA_CATALOG_HOME_RULES_INVALID'::text),
        (jsonb_set(rules, '{5,district_name}', '"Default"')::jsonb, 'CAJA_CATALOG_HOME_RULES_INVALID'::text),
        (jsonb_set(rules, '{5,pricing_mode}', '"FIXED"')::jsonb, 'CAJA_CATALOG_HOME_RULES_INVALID'::text)
    ) as cases(bad, code)
  loop
    begin
      perform public.caja_import_catalog_snapshot_v1(r, s, h, bad);
      raise exception 'QA_018_HOME_DEBIO_RECHAZAR';
    exception when raise_exception then
      if sqlerrm <> code then raise; end if;
    end;
  end loop;
  begin perform public.caja_import_catalog_snapshot_v1(r,s,h || jsonb_build_object('policy_sha256',repeat('0',64)),rules); raise exception 'QA_018_CHECKSUM_DEBIO_RECHAZAR'; exception when raise_exception then if sqlerrm<>'CAJA_CATALOG_HOME_MANIFEST_INVALID' then raise; end if; end;
  begin perform public.caja_import_catalog_snapshot_v1(jsonb_set(r,'{release_id}','"otro"'),s,h,rules); raise exception 'QA_018_RELEASE_DEBIO_RECHAZAR'; exception when raise_exception then if sqlerrm<>'CAJA_CATALOG_RELEASE_INVALID' then raise; end if; end;
  begin perform public.caja_import_catalog_snapshot_v1(r,jsonb_set(s,'{0,price_pen}','101'),h,rules); raise exception 'QA_018_CONFLICTO_DEBIO_RECHAZAR'; exception when raise_exception then if sqlerrm<>'CAJA_CATALOG_CONTENT_CONFLICT' then raise; end if; end;
  if (select count(*) from public.caja_catalog_releases where active)<>1 or not exists (select 1 from public.caja_catalog_releases where release_id='catalog-v1-web-4104385' and active) then raise exception 'QA_018_ACTIVACION_ATOMICA'; end if;
end;
$$;
rollback;

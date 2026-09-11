-- Alinea el snapshot local con el contrato canónico; 018 ya aplicada queda intacta.
begin;

do $$
begin
  if exists (select 1 from public.caja_catalog_releases) then
    raise exception 'CAJA_CATALOG_CONTRACT_ALIGNMENT_REQUIRES_EMPTY_SNAPSHOT';
  end if;
end;
$$;

alter table public.caja_catalog_services rename column effective_from to valid_from;
alter table public.caja_catalog_services rename column effective_to to valid_to;
alter table public.caja_catalog_services
  add column price_version text not null check (btrim(price_version) <> '');

create or replace function public.caja_import_catalog_snapshot_v1(
  p_release jsonb, p_services jsonb, p_home_manifest jsonb, p_home_rules jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_release text:=btrim(coalesce(p_release->>'release_id','')); v_existing public.caja_catalog_releases%rowtype;
  v_count int; v_distinct int; v_valid int; v_categories jsonb; v_policy text:=btrim(coalesce(p_home_manifest->>'policy_id',''));
begin
  if jsonb_typeof(p_release)<>'object' or jsonb_typeof(p_services)<>'array' or jsonb_typeof(p_home_manifest)<>'object' or jsonb_typeof(p_home_rules)<>'array' then raise exception 'CAJA_CATALOG_PAYLOAD_INVALID'; end if;
  if v_release<>'catalog-v1-web-4104385' or coalesce((p_release->>'expected_service_count')::int,0)<>50
    or coalesce(p_release->>'source_web_sha','') !~ '^[0-9a-f]{40}$' or btrim(coalesce(p_release->>'source_path',''))=''
    or coalesce(p_release->>'source_snapshot_sha256','') !~ '^[0-9a-f]{64}$' then raise exception 'CAJA_CATALOG_RELEASE_INVALID'; end if;
  if jsonb_array_length(p_services)<>50 then raise exception 'CAJA_CATALOG_SERVICE_COUNT_INVALID'; end if;
  with s as (select * from jsonb_to_recordset(p_services) as x(release_id text,service_code text,slug text,name_es text,name_en text,included_es text,included_en text,category text,commercial_group text,modality text,duration_min int,people_rule_status text,people_min int,people_max int,selection_rule text,reservation_behavior text,component_eligible boolean,component_eligibility_status text,active boolean,price_pen numeric,previous_price_pen numeric,price_version text,valid_from timestamptz,valid_to timestamptz)), stats as (select count(*) n,count(distinct service_code) d,count(*) filter(where release_id=v_release and active and price_pen>0 and duration_min>0 and people_min>0 and people_max>=people_min and component_eligibility_status='PENDING_REVIEW' and btrim(coalesce(price_version,''))<>'' and valid_from is not null and (valid_to is null or valid_to>valid_from)) valid from s), cats as (select jsonb_object_agg(category,n) value from (select category,count(*) n from s group by category) q)
  select stats.n,stats.d,stats.valid,cats.value into v_count,v_distinct,v_valid,v_categories from stats cross join cats;
  if v_count<>50 or v_distinct<>50 or v_valid<>50 or v_categories <> '{"INDIVIDUAL":23,"PACKAGE_TWO":14,"HOME":2,"PROGRAM":4,"BEAUTY":3,"FACIAL":4}'::jsonb then raise exception 'CAJA_CATALOG_SERVICES_INVALID'; end if;
  if not exists (select 1 from jsonb_to_recordset(p_services) as x(service_code text,category text,people_min int,people_max int,selection_rule text,reservation_behavior text) where service_code='SVC_008' and category='HOME' and people_min=1 and people_max=2 and selection_rule='HOME_FLOW' and reservation_behavior='HOME_APPOINTMENT')
    or not exists (select 1 from jsonb_to_recordset(p_services) as x(service_code text,category text,people_min int,people_max int,selection_rule text,reservation_behavior text) where service_code='SVC_009' and category='HOME' and people_min=1 and people_max=2 and selection_rule='HOME_FLOW' and reservation_behavior='HOME_APPOINTMENT') then raise exception 'CAJA_CATALOG_HOME_SERVICES_INVALID'; end if;
  if p_home_manifest->>'release_id'<>v_release or v_policy<>'HOME_MOBILITY_V1' or p_home_manifest->>'charge_scope'<>'PER_APPOINTMENT' or p_home_manifest->>'policy_sha256'<>'c94adc0adb80f56af291221a4363a4ddcd319790af73b64e2c9a42f69dee9bf1' or jsonb_array_length(p_home_rules)<>6 then raise exception 'CAJA_CATALOG_HOME_MANIFEST_INVALID'; end if;
  if not (select count(*)=6 and count(distinct case when scope='DEFAULT' then 'DEFAULT' else district_normalized end)=6 from jsonb_to_recordset(p_home_rules) as h(scope text,district_code text,district_name text,district_normalized text,pricing_mode text,fee_pen numeric,requires_confirmation boolean)) then raise exception 'CAJA_CATALOG_HOME_RULES_INVALID'; end if;
  if exists (with actual as (select scope,district_code,district_name,district_normalized,pricing_mode,fee_pen,requires_confirmation from jsonb_to_recordset(p_home_rules) as h(scope text,district_code text,district_name text,district_normalized text,pricing_mode text,fee_pen numeric,requires_confirmation boolean)), expected as (values ('DISTRICT'::text,'MIRAFLORES'::text,'Miraflores'::text,'MIRAFLORES'::text,'INCLUDED'::text,0::numeric,false),('DISTRICT','SAN_BORJA','San Borja','SAN BORJA','FIXED',30::numeric,false),('DISTRICT','SURCO','Surco','SURCO','FIXED',30::numeric,false),('DISTRICT','SAN_ISIDRO','San Isidro','SAN ISIDRO','FIXED',30::numeric,false),('DISTRICT','BARRANCO','Barranco','BARRANCO','FIXED',30::numeric,false),('DEFAULT',null::text,null::text,null::text,'MANUAL_CONFIRMATION',null::numeric,true)) select 1 from ((select * from actual except select * from expected) union all (select * from expected except select * from actual)) differences) then raise exception 'CAJA_CATALOG_HOME_RULES_INVALID'; end if;
  select * into v_existing from public.caja_catalog_releases where release_id=v_release for update;
  if found then
    if v_existing.source_web_sha<>p_release->>'source_web_sha' or v_existing.source_path<>p_release->>'source_path' or v_existing.source_snapshot_sha256<>p_release->>'source_snapshot_sha256' or v_existing.expected_service_count<>50 or v_existing.home_policy_id<>v_policy or v_existing.home_policy_sha256<>p_home_manifest->>'policy_sha256' then raise exception 'CAJA_CATALOG_RELEASE_CONFLICT'; end if;
    if (select count(*) from public.caja_catalog_services where release_id=v_release)<>50 or (select count(*) from public.caja_catalog_home_policy where release_id=v_release and policy_id=v_policy)<>6 then raise exception 'CAJA_CATALOG_CONTENT_CONFLICT'; end if;
    if exists (with incoming as (select release_id,service_code,slug,name_es,name_en,included_es,included_en,category,commercial_group,modality,duration_min,people_rule_status,people_min,people_max,selection_rule,reservation_behavior,component_eligible,component_eligibility_status,active,price_pen,previous_price_pen,price_version,valid_from,valid_to from jsonb_to_recordset(p_services) as x(release_id text,service_code text,slug text,name_es text,name_en text,included_es text,included_en text,category text,commercial_group text,modality text,duration_min int,people_rule_status text,people_min int,people_max int,selection_rule text,reservation_behavior text,component_eligible boolean,component_eligibility_status text,active boolean,price_pen numeric,previous_price_pen numeric,price_version text,valid_from timestamptz,valid_to timestamptz)) select 1 from ((select release_id,service_code,slug,name_es,name_en,included_es,included_en,category,commercial_group,modality,duration_min,people_rule_status,people_min,people_max,selection_rule,reservation_behavior,component_eligible,component_eligibility_status,active,price_pen,previous_price_pen,price_version,valid_from,valid_to from public.caja_catalog_services where release_id=v_release except select * from incoming) union all (select * from incoming except select release_id,service_code,slug,name_es,name_en,included_es,included_en,category,commercial_group,modality,duration_min,people_rule_status,people_min,people_max,selection_rule,reservation_behavior,component_eligible,component_eligibility_status,active,price_pen,previous_price_pen,price_version,valid_from,valid_to from public.caja_catalog_services where release_id=v_release)) d) then raise exception 'CAJA_CATALOG_CONTENT_CONFLICT'; end if;
  else
    insert into public.caja_catalog_releases(release_id,source_web_sha,source_path,source_snapshot_sha256,expected_service_count,home_policy_id,home_policy_sha256) values(v_release,p_release->>'source_web_sha',p_release->>'source_path',p_release->>'source_snapshot_sha256',50,v_policy,p_home_manifest->>'policy_sha256');
    insert into public.caja_catalog_services(release_id,service_code,slug,name_es,name_en,included_es,included_en,category,commercial_group,modality,duration_min,people_rule_status,people_min,people_max,selection_rule,reservation_behavior,component_eligible,component_eligibility_status,active,price_pen,previous_price_pen,valid_from,valid_to,price_version)
    select release_id,service_code,slug,name_es,name_en,included_es,included_en,category,commercial_group,modality,duration_min,people_rule_status,people_min,people_max,selection_rule,reservation_behavior,component_eligible,component_eligibility_status,active,price_pen,previous_price_pen,valid_from,valid_to,price_version
    from jsonb_to_recordset(p_services) as x(release_id text,service_code text,slug text,name_es text,name_en text,included_es text,included_en text,category text,commercial_group text,modality text,duration_min int,people_rule_status text,people_min int,people_max int,selection_rule text,reservation_behavior text,component_eligible boolean,component_eligibility_status text,active boolean,price_pen numeric,previous_price_pen numeric,price_version text,valid_from timestamptz,valid_to timestamptz);
    insert into public.caja_catalog_home_policy(release_id,policy_id,policy_sha256,charge_scope,rule_key,scope,district_code,district_name,district_normalized,pricing_mode,fee_pen,requires_confirmation,active) select v_release,v_policy,p_home_manifest->>'policy_sha256','PER_APPOINTMENT',case when scope='DEFAULT' then 'DEFAULT' else district_normalized end,scope,district_code,district_name,district_normalized,pricing_mode,fee_pen,requires_confirmation,true from jsonb_to_recordset(p_home_rules) as h(scope text,district_code text,district_name text,district_normalized text,pricing_mode text,fee_pen numeric,requires_confirmation boolean);
  end if;
  perform set_config('app.caja_catalog_snapshot_activation',v_release,true);
  begin update public.caja_catalog_releases set active=false where active and release_id<>v_release; update public.caja_catalog_releases set active=true,synced_at=clock_timestamp() where release_id=v_release; perform set_config('app.caja_catalog_snapshot_activation','',true); exception when others then perform set_config('app.caja_catalog_snapshot_activation','',true); raise; end;
  return jsonb_build_object('release_id',v_release,'services',50,'home_rules',6,'active',true);
end;
$$;

create or replace function public.caja_catalog_snapshot_status_v1() returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select coalesce((select jsonb_build_object('release_id',r.release_id,'services',(select count(*) from public.caja_catalog_services s where s.release_id=r.release_id),'home_rules',(select count(*) from public.caja_catalog_home_policy h where h.release_id=r.release_id and h.active),'home_policy_sha256',r.home_policy_sha256,'local_fingerprint',md5(coalesce((select string_agg(service_code||'|'||price_pen::text||'|'||price_version||'|'||valid_from::text||'|'||coalesce(valid_to::text,'NULL'),E'\n' order by service_code) from public.caja_catalog_services s where s.release_id=r.release_id),''))) from public.caja_catalog_releases r where r.active), '{}'::jsonb);
$$;

revoke all on function public.caja_import_catalog_snapshot_v1(jsonb,jsonb,jsonb,jsonb),public.caja_catalog_snapshot_status_v1() from public,anon,authenticated;
grant execute on function public.caja_import_catalog_snapshot_v1(jsonb,jsonb,jsonb,jsonb),public.caja_catalog_snapshot_status_v1() to service_role;

commit;

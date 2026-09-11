-- Fase 3B.0-B. Preparar y aplicar manualmente solo con autorización separada.
-- El snapshot local es inmutable y NO es una fuente de verdad editable.
begin;

create table if not exists public.caja_catalog_releases (
  release_id text primary key,
  source_web_sha text not null check (source_web_sha ~ '^[0-9a-f]{40}$'),
  source_path text not null,
  source_snapshot_sha256 text not null check (source_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  expected_service_count integer not null check (expected_service_count > 0),
  home_policy_id text not null,
  home_policy_sha256 text not null check (home_policy_sha256 ~ '^[0-9a-f]{64}$'),
  synced_at timestamptz not null default clock_timestamp(),
  active boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
create unique index if not exists caja_catalog_one_active_release on public.caja_catalog_releases(active) where active;

create table if not exists public.caja_catalog_services (
  release_id text not null references public.caja_catalog_releases(release_id) on delete restrict,
  service_code text not null check (service_code ~ '^SVC_[0-9]{3}$'), slug text not null,
  name_es text not null, name_en text, included_es text, included_en text, category text not null,
  commercial_group text, modality text not null, duration_min integer not null check (duration_min > 0),
  people_rule_status text not null, people_min integer not null check (people_min > 0),
  people_max integer not null check (people_max >= people_min), selection_rule text not null,
  reservation_behavior text not null, component_eligible boolean,
  component_eligibility_status text not null check (component_eligibility_status = 'PENDING_REVIEW'),
  active boolean not null check (active), price_pen numeric(12,2) not null check (price_pen > 0),
  previous_price_pen numeric(12,2), effective_from timestamptz not null, effective_to timestamptz,
  primary key (release_id, service_code)
);

create table if not exists public.caja_catalog_home_policy (
  release_id text not null references public.caja_catalog_releases(release_id) on delete restrict,
  policy_id text not null, policy_sha256 text not null check (policy_sha256 ~ '^[0-9a-f]{64}$'),
  charge_scope text not null check (charge_scope = 'PER_APPOINTMENT'), rule_key text not null,
  scope text not null check (scope in ('DISTRICT','DEFAULT')), district_code text, district_name text,
  district_normalized text, pricing_mode text not null check (pricing_mode in ('INCLUDED','FIXED','MANUAL_CONFIRMATION')),
  fee_pen numeric(12,2), requires_confirmation boolean not null, active boolean not null check (active),
  primary key (release_id, policy_id, rule_key),
  check ((scope='DEFAULT' and rule_key='DEFAULT' and district_code is null and district_name is null and district_normalized is null)
    or (scope='DISTRICT' and rule_key=district_normalized and district_code is not null and district_name is not null and district_normalized is not null)),
  check ((pricing_mode='INCLUDED' and fee_pen=0 and requires_confirmation=false)
    or (pricing_mode='FIXED' and fee_pen>0 and requires_confirmation=false)
    or (pricing_mode='MANUAL_CONFIRMATION' and fee_pen is null and requires_confirmation=true))
);

create or replace function public.caja_catalog_snapshot_immutable_guard_v1() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_table_name in ('caja_catalog_services','caja_catalog_home_policy') and tg_op in ('UPDATE','DELETE') then
    raise exception 'CAJA_CATALOG_SNAPSHOT_IMMUTABLE';
  end if;
  if tg_table_name='caja_catalog_releases' and tg_op='DELETE' then raise exception 'CAJA_CATALOG_SNAPSHOT_IMMUTABLE'; end if;
  if tg_table_name='caja_catalog_releases' and tg_op='UPDATE' then
    if current_setting('app.caja_catalog_snapshot_activation',true) <> new.release_id
      or new.release_id is distinct from old.release_id or new.source_web_sha is distinct from old.source_web_sha
      or new.source_path is distinct from old.source_path or new.source_snapshot_sha256 is distinct from old.source_snapshot_sha256
      or new.expected_service_count is distinct from old.expected_service_count or new.home_policy_id is distinct from old.home_policy_id
      or new.home_policy_sha256 is distinct from old.home_policy_sha256 or new.created_at is distinct from old.created_at then
      raise exception 'CAJA_CATALOG_SNAPSHOT_IMMUTABLE';
    end if;
  end if;
  return coalesce(new,old);
end;
$$;
drop trigger if exists caja_catalog_release_immutable on public.caja_catalog_releases;
create trigger caja_catalog_release_immutable before update or delete on public.caja_catalog_releases for each row execute function public.caja_catalog_snapshot_immutable_guard_v1();
drop trigger if exists caja_catalog_services_immutable on public.caja_catalog_services;
create trigger caja_catalog_services_immutable before update or delete on public.caja_catalog_services for each row execute function public.caja_catalog_snapshot_immutable_guard_v1();
drop trigger if exists caja_catalog_home_immutable on public.caja_catalog_home_policy;
create trigger caja_catalog_home_immutable before update or delete on public.caja_catalog_home_policy for each row execute function public.caja_catalog_snapshot_immutable_guard_v1();

create or replace function public.caja_import_catalog_snapshot_v1(
  p_release jsonb, p_services jsonb, p_home_manifest jsonb, p_home_rules jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_release text:=btrim(coalesce(p_release->>'release_id','')); v_existing public.caja_catalog_releases%rowtype;
  v_count int; v_distinct int; v_home int; v_categories jsonb; v_policy text:=btrim(coalesce(p_home_manifest->>'policy_id',''));
begin
  if jsonb_typeof(p_release)<>'object' or jsonb_typeof(p_services)<>'array' or jsonb_typeof(p_home_manifest)<>'object' or jsonb_typeof(p_home_rules)<>'array' then raise exception 'CAJA_CATALOG_PAYLOAD_INVALID'; end if;
  if v_release<>'catalog-v1-web-4104385' or coalesce((p_release->>'expected_service_count')::int,0)<>50
    or coalesce(p_release->>'source_web_sha','') !~ '^[0-9a-f]{40}$' or btrim(coalesce(p_release->>'source_path',''))=''
    or coalesce(p_release->>'source_snapshot_sha256','') !~ '^[0-9a-f]{64}$' then raise exception 'CAJA_CATALOG_RELEASE_INVALID'; end if;
  if jsonb_array_length(p_services)<>50 then raise exception 'CAJA_CATALOG_SERVICE_COUNT_INVALID'; end if;
  with s as (select * from jsonb_to_recordset(p_services) as x(release_id text,service_code text,slug text,name_es text,name_en text,included_es text,included_en text,category text,commercial_group text,modality text,duration_min int,people_rule_status text,people_min int,people_max int,selection_rule text,reservation_behavior text,component_eligible boolean,component_eligibility_status text,active boolean,price_pen numeric,previous_price_pen numeric,effective_from timestamptz,effective_to timestamptz)), stats as (select count(*) n,count(distinct service_code) d,count(*) filter(where release_id=v_release and active and price_pen>0 and duration_min>0 and people_min>0 and people_max>=people_min and component_eligibility_status='PENDING_REVIEW') valid from s), cats as (select jsonb_object_agg(category,n) value from (select category,count(*) n from s group by category) q)
  select stats.n,stats.d,stats.valid,cats.value into v_count,v_distinct,v_home,v_categories from stats cross join cats;
  if v_count<>50 or v_distinct<>50 or v_home<>50 or v_categories <> '{"INDIVIDUAL":23,"PACKAGE_TWO":14,"HOME":2,"PROGRAM":4,"BEAUTY":3,"FACIAL":4}'::jsonb then raise exception 'CAJA_CATALOG_SERVICES_INVALID'; end if;
  if not exists (select 1 from jsonb_to_recordset(p_services) as x(service_code text,category text,people_min int,people_max int,selection_rule text,reservation_behavior text) where service_code='SVC_008' and category='HOME' and people_min=1 and people_max=2 and selection_rule='HOME_FLOW' and reservation_behavior='HOME_APPOINTMENT')
    or not exists (select 1 from jsonb_to_recordset(p_services) as x(service_code text,category text,people_min int,people_max int,selection_rule text,reservation_behavior text) where service_code='SVC_009' and category='HOME' and people_min=1 and people_max=2 and selection_rule='HOME_FLOW' and reservation_behavior='HOME_APPOINTMENT') then raise exception 'CAJA_CATALOG_HOME_SERVICES_INVALID'; end if;
  if p_home_manifest->>'release_id'<>v_release or v_policy<>'HOME_MOBILITY_V1' or p_home_manifest->>'charge_scope'<>'PER_APPOINTMENT' or p_home_manifest->>'policy_sha256'<>'c94adc0adb80f56af291221a4363a4ddcd319790af73b64e2c9a42f69dee9bf1' or jsonb_array_length(p_home_rules)<>6 then raise exception 'CAJA_CATALOG_HOME_MANIFEST_INVALID'; end if;
  if not (select count(*)=6 and count(distinct case when scope='DEFAULT' then 'DEFAULT' else district_normalized end)=6 from jsonb_to_recordset(p_home_rules) as h(scope text,district_code text,district_name text,district_normalized text,pricing_mode text,fee_pen numeric,requires_confirmation boolean)) then raise exception 'CAJA_CATALOG_HOME_RULES_INVALID'; end if;
  -- El hash contractual llega validado por el servidor; SQL protege además cada campo de cada regla.
  if exists (with actual as (
    select scope,district_code,district_name,district_normalized,pricing_mode,fee_pen,requires_confirmation
    from jsonb_to_recordset(p_home_rules) as h(scope text,district_code text,district_name text,district_normalized text,pricing_mode text,fee_pen numeric,requires_confirmation boolean)
  ), expected as (
    values
      ('DISTRICT'::text,'MIRAFLORES'::text,'Miraflores'::text,'MIRAFLORES'::text,'INCLUDED'::text,0::numeric,false),
      ('DISTRICT','SAN_BORJA','San Borja','SAN BORJA','FIXED',30::numeric,false),
      ('DISTRICT','SURCO','Surco','SURCO','FIXED',30::numeric,false),
      ('DISTRICT','SAN_ISIDRO','San Isidro','SAN ISIDRO','FIXED',30::numeric,false),
      ('DISTRICT','BARRANCO','Barranco','BARRANCO','FIXED',30::numeric,false),
      ('DEFAULT',null::text,null::text,null::text,'MANUAL_CONFIRMATION',null::numeric,true)
  ) select 1 from ((select * from actual except select * from expected) union all (select * from expected except select * from actual)) differences) then
    raise exception 'CAJA_CATALOG_HOME_RULES_INVALID';
  end if;
  select * into v_existing from public.caja_catalog_releases where release_id=v_release for update;
  if found then
    if v_existing.source_web_sha<>p_release->>'source_web_sha' or v_existing.source_path<>p_release->>'source_path' or v_existing.source_snapshot_sha256<>p_release->>'source_snapshot_sha256' or v_existing.expected_service_count<>50 or v_existing.home_policy_id<>v_policy or v_existing.home_policy_sha256<>p_home_manifest->>'policy_sha256' then raise exception 'CAJA_CATALOG_RELEASE_CONFLICT'; end if;
    if (select count(*) from public.caja_catalog_services where release_id=v_release)<>50 or (select count(*) from public.caja_catalog_home_policy where release_id=v_release and policy_id=v_policy)<>6 then raise exception 'CAJA_CATALOG_CONTENT_CONFLICT'; end if;
    if exists (with incoming as (select release_id,service_code,slug,name_es,name_en,included_es,included_en,category,commercial_group,modality,duration_min,people_rule_status,people_min,people_max,selection_rule,reservation_behavior,component_eligible,component_eligibility_status,active,price_pen,previous_price_pen,effective_from,effective_to from jsonb_to_recordset(p_services) as x(release_id text,service_code text,slug text,name_es text,name_en text,included_es text,included_en text,category text,commercial_group text,modality text,duration_min int,people_rule_status text,people_min int,people_max int,selection_rule text,reservation_behavior text,component_eligible boolean,component_eligibility_status text,active boolean,price_pen numeric,previous_price_pen numeric,effective_from timestamptz,effective_to timestamptz)) select 1 from ((select release_id,service_code,slug,name_es,name_en,included_es,included_en,category,commercial_group,modality,duration_min,people_rule_status,people_min,people_max,selection_rule,reservation_behavior,component_eligible,component_eligibility_status,active,price_pen,previous_price_pen,effective_from,effective_to from public.caja_catalog_services where release_id=v_release except select * from incoming) union all (select * from incoming except select release_id,service_code,slug,name_es,name_en,included_es,included_en,category,commercial_group,modality,duration_min,people_rule_status,people_min,people_max,selection_rule,reservation_behavior,component_eligible,component_eligibility_status,active,price_pen,previous_price_pen,effective_from,effective_to from public.caja_catalog_services where release_id=v_release)) d) then raise exception 'CAJA_CATALOG_CONTENT_CONFLICT'; end if;
    if exists (with incoming as (select v_release release_id,v_policy policy_id,p_home_manifest->>'policy_sha256' policy_sha256,'PER_APPOINTMENT' charge_scope,case when scope='DEFAULT' then 'DEFAULT' else district_normalized end rule_key,scope,district_code,district_name,district_normalized,pricing_mode,fee_pen,requires_confirmation,true active from jsonb_to_recordset(p_home_rules) as x(scope text,district_code text,district_name text,district_normalized text,pricing_mode text,fee_pen numeric,requires_confirmation boolean)) select 1 from ((select release_id,policy_id,policy_sha256,charge_scope,rule_key,scope,district_code,district_name,district_normalized,pricing_mode,fee_pen,requires_confirmation,active from public.caja_catalog_home_policy where release_id=v_release except select * from incoming) union all (select * from incoming except select release_id,policy_id,policy_sha256,charge_scope,rule_key,scope,district_code,district_name,district_normalized,pricing_mode,fee_pen,requires_confirmation,active from public.caja_catalog_home_policy where release_id=v_release)) d) then raise exception 'CAJA_CATALOG_CONTENT_CONFLICT'; end if;
  else
    insert into public.caja_catalog_releases(release_id,source_web_sha,source_path,source_snapshot_sha256,expected_service_count,home_policy_id,home_policy_sha256) values(v_release,p_release->>'source_web_sha',p_release->>'source_path',p_release->>'source_snapshot_sha256',50,v_policy,p_home_manifest->>'policy_sha256');
    insert into public.caja_catalog_services select * from jsonb_to_recordset(p_services) as x(release_id text,service_code text,slug text,name_es text,name_en text,included_es text,included_en text,category text,commercial_group text,modality text,duration_min int,people_rule_status text,people_min int,people_max int,selection_rule text,reservation_behavior text,component_eligible boolean,component_eligibility_status text,active boolean,price_pen numeric,previous_price_pen numeric,effective_from timestamptz,effective_to timestamptz);
    insert into public.caja_catalog_home_policy(release_id,policy_id,policy_sha256,charge_scope,rule_key,scope,district_code,district_name,district_normalized,pricing_mode,fee_pen,requires_confirmation,active) select v_release,v_policy,p_home_manifest->>'policy_sha256','PER_APPOINTMENT',case when scope='DEFAULT' then 'DEFAULT' else district_normalized end,scope,district_code,district_name,district_normalized,pricing_mode,fee_pen,requires_confirmation,true from jsonb_to_recordset(p_home_rules) as h(scope text,district_code text,district_name text,district_normalized text,pricing_mode text,fee_pen numeric,requires_confirmation boolean);
  end if;
  perform set_config('app.caja_catalog_snapshot_activation',v_release,true);
  begin update public.caja_catalog_releases set active=false where active and release_id<>v_release; update public.caja_catalog_releases set active=true,synced_at=clock_timestamp() where release_id=v_release; perform set_config('app.caja_catalog_snapshot_activation','',true); exception when others then perform set_config('app.caja_catalog_snapshot_activation','',true); raise; end;
  return jsonb_build_object('release_id',v_release,'services',50,'home_rules',6,'active',true);
end;
$$;

create or replace function public.caja_catalog_snapshot_status_v1() returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select coalesce((select jsonb_build_object('release_id',r.release_id,'services',(select count(*) from public.caja_catalog_services s where s.release_id=r.release_id),'home_rules',(select count(*) from public.caja_catalog_home_policy h where h.release_id=r.release_id and h.active),'home_policy_sha256',r.home_policy_sha256,'local_fingerprint',md5(coalesce((select string_agg(service_code||'|'||price_pen::text||'|'||duration_min::text,E'\n' order by service_code) from public.caja_catalog_services s where s.release_id=r.release_id),''))) from public.caja_catalog_releases r where r.active), '{}'::jsonb);
$$;

alter table public.caja_catalog_releases enable row level security;
alter table public.caja_catalog_services enable row level security;
alter table public.caja_catalog_home_policy enable row level security;
revoke all on table public.caja_catalog_releases,public.caja_catalog_services,public.caja_catalog_home_policy from public,anon,authenticated,service_role;
revoke all on function public.caja_import_catalog_snapshot_v1(jsonb,jsonb,jsonb,jsonb),public.caja_catalog_snapshot_status_v1(),public.caja_catalog_snapshot_immutable_guard_v1() from public,anon,authenticated;
grant execute on function public.caja_import_catalog_snapshot_v1(jsonb,jsonb,jsonb,jsonb),public.caja_catalog_snapshot_status_v1() to service_role;
commit;

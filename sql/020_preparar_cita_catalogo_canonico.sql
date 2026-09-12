-- Fase 3B.1-A. Aplicar manualmente solo después de revisión y autorización.
-- Frontera privada de lectura para Preparar cita; no muta el snapshot.
begin;

create or replace function public.caja_catalog_active_services_read_v1()
returns table (
  service_code text,
  name_es text,
  duration_min integer,
  price_pen numeric,
  category text,
  commercial_group text,
  modality text,
  people_min integer,
  people_max integer,
  selection_rule text,
  reservation_behavior text,
  price_version text,
  valid_from timestamptz,
  valid_to timestamptz,
  release_id text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    s.service_code, s.name_es, s.duration_min, s.price_pen, s.category,
    s.commercial_group, s.modality, s.people_min, s.people_max,
    s.selection_rule, s.reservation_behavior, s.price_version,
    s.valid_from, s.valid_to, s.release_id
  from public.caja_catalog_releases r
  join public.caja_catalog_services s on s.release_id = r.release_id
  where r.active is true and s.active is true
  order by s.service_code;
$$;

create or replace function public.caja_catalog_home_policy_read_v1()
returns table (
  scope text,
  district_code text,
  district_name text,
  district_normalized text,
  pricing_mode text,
  fee_pen numeric,
  requires_confirmation boolean,
  policy_id text,
  policy_sha256 text,
  release_id text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    h.scope, h.district_code, h.district_name, h.district_normalized,
    h.pricing_mode, h.fee_pen, h.requires_confirmation,
    h.policy_id, h.policy_sha256, h.release_id
  from public.caja_catalog_releases r
  join public.caja_catalog_home_policy h on h.release_id = r.release_id
  where r.active is true and h.active is true
  order by case when h.scope = 'DEFAULT' then 1 else 0 end, h.rule_key;
$$;

-- Resolución transaccional reutilizable por las RPC de guardado. Devuelve
-- exclusivamente datos recalculados desde el snapshot local activo; ignora
-- cualquier nombre, precio, duración, release o versión enviados por cliente.
create or replace function public.caja_catalog_resolve_appointment_v1(
  p_service_codes jsonb,
  p_people integer,
  p_district text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_release text;
  v_services jsonb;
  v_count integer;
  v_all_home boolean;
  v_any_home boolean;
  v_selection_valid boolean;
  v_district text;
  v_policy public.caja_catalog_home_policy%rowtype;
  v_subtotal numeric(12,2);
begin
  if p_people not in (1, 2) or jsonb_typeof(p_service_codes) <> 'array'
     or jsonb_array_length(p_service_codes) = 0 then
    raise exception 'CAJA_APPOINTMENT_SELECTION_INVALID';
  end if;

  select r.release_id into v_release
  from public.caja_catalog_releases r
  where r.active is true;
  if v_release is null then raise exception 'CAJA_CATALOG_ACTIVE_RELEASE_MISSING'; end if;
  if (select count(*) from public.caja_catalog_services s where s.release_id = v_release and s.active) <> 50 then
    raise exception 'CAJA_CATALOG_ACTIVE_SNAPSHOT_INVALID';
  end if;

  with requested as (
    select btrim(value #>> '{}') service_code, ord
    from jsonb_array_elements(p_service_codes) with ordinality x(value, ord)
  ), resolved as (
    select q.ord, s.*
    from requested q
    left join public.caja_catalog_services s
      on s.release_id = v_release and s.active and s.service_code = q.service_code
  )
  select
    count(*) filter (where service_code is not null),
    bool_and(category = 'HOME' or modality = 'HOME'),
    bool_or(category = 'HOME' or modality = 'HOME'),
    round(sum(price_pen), 2),
    jsonb_agg(jsonb_build_object(
      'codigo', service_code,
      'nombre', name_es,
      'duracion_min', duration_min,
      'precio', price_pen,
      'release_id', release_id,
      'price_version', price_version,
      'category', category,
      'modality', modality,
      'people_min', people_min,
      'people_max', people_max,
      'selection_rule', selection_rule,
      'reservation_behavior', reservation_behavior
    ) order by ord)
  into v_count, v_all_home, v_any_home, v_subtotal, v_services
  from resolved;

  if v_count <> jsonb_array_length(p_service_codes) or v_any_home <> v_all_home then
    raise exception 'CAJA_APPOINTMENT_SERVICE_INVALID';
  end if;

  select case
    when v_all_home then
      jsonb_array_length(v_services) = p_people
      and not exists (select 1 from jsonb_array_elements(v_services) x where x->>'selection_rule' <> 'HOME_FLOW' or x->>'reservation_behavior' <> 'HOME_APPOINTMENT' or p_people < (x->>'people_min')::int or p_people > (x->>'people_max')::int)
    when p_people = 1 then
      jsonb_array_length(v_services) = 1
      and v_services->0->>'selection_rule' = 'ONE_PERSON'
      and v_services->0->>'reservation_behavior' = 'APPOINTMENT'
    when jsonb_array_length(v_services) = 1 then
      v_services->0->>'selection_rule' = 'FIXED_TWO_PACKAGE'
      and v_services->0->>'reservation_behavior' = 'APPOINTMENT'
      and (v_services->0->>'people_min')::int = 2
      and (v_services->0->>'people_max')::int = 2
    else
      jsonb_array_length(v_services) = 2
      and not exists (select 1 from jsonb_array_elements(v_services) x where x->>'selection_rule' <> 'ONE_PERSON' or x->>'reservation_behavior' <> 'APPOINTMENT')
  end into v_selection_valid;
  if not coalesce(v_selection_valid, false) then raise exception 'CAJA_APPOINTMENT_SELECTION_INVALID'; end if;

  if not v_all_home then
    return jsonb_build_object('release_id', v_release, 'services', v_services,
      'subtotal', v_subtotal, 'mobility_fee', 0, 'total', v_subtotal,
      'requires_confirmation', false);
  end if;

  v_district := btrim(regexp_replace(upper(translate(coalesce(p_district, ''),
    'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNAEIOUUN')), '[^A-Z0-9]+', ' ', 'g'));
  select h.* into v_policy
  from public.caja_catalog_home_policy h
  where h.release_id = v_release and h.active
    and h.scope = 'DISTRICT' and h.district_normalized = v_district;
  if not found then
    select h.* into v_policy from public.caja_catalog_home_policy h
    where h.release_id = v_release and h.active and h.scope = 'DEFAULT';
  end if;
  if not found then raise exception 'CAJA_HOME_POLICY_MISSING'; end if;

  if v_policy.pricing_mode = 'MANUAL_CONFIRMATION' then
    return jsonb_build_object('release_id', v_release, 'services', v_services,
      'subtotal', v_subtotal, 'mobility_fee', null, 'total', null,
      'requires_confirmation', true, 'policy_id', v_policy.policy_id,
      'policy_sha256', v_policy.policy_sha256);
  end if;
  return jsonb_build_object('release_id', v_release, 'services', v_services,
    'subtotal', v_subtotal, 'mobility_fee', v_policy.fee_pen,
    'total', round(v_subtotal + v_policy.fee_pen, 2),
    'requires_confirmation', v_policy.requires_confirmation,
    'policy_id', v_policy.policy_id, 'policy_sha256', v_policy.policy_sha256);
end;
$$;

-- Las RPC transaccionales 016/017 se mantienen como contrato de escritura,
-- pero su fuente de catálogo se redirige a esta proyección del snapshot local.
-- La forma legacy queda encapsulada dentro de SQL y nunca se expone al cliente.
create or replace view public.caja_catalog_active_services_legacy_shape_v1 as
select
  s.service_code as "CodeId",
  s.name_es as option_name,
  s.duration_min,
  s.price_pen,
  s.price_pen as price,
  s.active,
  s.category,
  s.modality,
  s.people_min,
  s.people_max,
  s.selection_rule,
  s.reservation_behavior,
  s.release_id,
  s.price_version
from public.caja_catalog_releases r
join public.caja_catalog_services s on s.release_id = r.release_id
where r.active is true and s.active is true;

do $$
declare
  v_definition text;
  v_updated text;
begin
  v_definition := pg_get_functiondef('public.preparar_ficha_cita(jsonb)'::regprocedure);
  v_updated := replace(v_definition,
    'public.stg_services_catalog_v5',
    'public.caja_catalog_active_services_legacy_shape_v1');
  v_updated := replace(v_updated,
    '(''DOM-1H'', ''DOM-2H'')',
    '(''SVC_008'', ''SVC_009'')');
  v_updated := replace(v_updated,
    'or jsonb_array_length(v_entrada_servicios) <> v_personas then',
    'or (jsonb_array_length(v_entrada_servicios) <> v_personas and not (v_personas = 2 and jsonb_array_length(v_entrada_servicios) = 1)) then');
  v_updated := replace(v_updated,
    'v_movilidad := 15;
    v_requiere_confirmacion := true;',
    $patch$select h.fee_pen, h.requires_confirmation
      into v_movilidad, v_requiere_confirmacion
    from public.caja_catalog_home_policy h
    where h.release_id = (select release_id from public.caja_catalog_releases where active)
      and h.active
      and (h.scope = 'DISTRICT' and h.district_normalized = btrim(regexp_replace(upper(translate(v_distrito,
        'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNAEIOUUN')), '[^A-Z0-9]+', ' ', 'g'))
        or h.scope = 'DEFAULT')
    order by case when h.scope = 'DISTRICT' then 0 else 1 end
    limit 1;
    if v_movilidad is null then
      raise exception using errcode = '22023', message = 'MOVILIDAD_HOME_REQUIERE_CONFIRMACION_MANUAL';
    end if;$patch$);
  if v_updated = v_definition
     or position('public.stg_services_catalog_v5' in v_updated) > 0
     or position('DOM-1H' in v_updated) > 0
     or position('v_movilidad := 15' in v_updated) > 0 then
    raise exception 'CAJA_PREPARAR_CITA_RPC_PATCH_FAILED';
  end if;
  execute v_updated;

  v_definition := pg_get_functiondef('public.preparar_atencion_personalizada(jsonb)'::regprocedure);
  v_updated := replace(v_definition,
    'public.stg_services_catalog_v5',
    'public.caja_catalog_active_services_legacy_shape_v1');
  if v_updated = v_definition or position('public.stg_services_catalog_v5' in v_updated) > 0 then
    raise exception 'CAJA_PREPARAR_PERSONALIZADA_RPC_PATCH_FAILED';
  end if;
  execute v_updated;
end;
$$;

create or replace function public.caja_preparar_cita_catalog_metadata_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_release text;
begin
  if new.source <> 'APP_CAJA_FICHA' then return new; end if;
  select release_id into v_release from public.caja_catalog_releases where active;
  if v_release is null then raise exception 'CAJA_CATALOG_ACTIVE_RELEASE_MISSING'; end if;

  if not coalesce(new.atencion_personalizada, false) then
    select jsonb_agg(
      item.value || jsonb_build_object('release_id', s.release_id, 'price_version', s.price_version)
      order by item.ordinality
    ) into new.servicios_json
    from jsonb_array_elements(coalesce(new.servicios_json, '[]'::jsonb)) with ordinality item(value, ordinality)
    join public.caja_catalog_services s
      on s.release_id = v_release and s.active and s.service_code = item.value->>'codigo';
    if new.servicios_json is null then raise exception 'CAJA_CATALOG_PERSISTENCE_METADATA_INVALID'; end if;
  else
    select jsonb_agg(
      persona.value || jsonb_build_object('componentes', (
        select jsonb_agg(
          case when component.value->>'tipo' = 'catalogo'
            then component.value || jsonb_build_object('release_id', s.release_id, 'price_version', s.price_version)
            else component.value end
          order by component.ordinality
        )
        from jsonb_array_elements(persona.value->'componentes') with ordinality component(value, ordinality)
        left join public.caja_catalog_services s
          on s.release_id = v_release and s.active and s.service_code = component.value->>'codigo'
      )) order by persona.ordinality
    ) into new.componentes_por_persona
    from jsonb_array_elements(coalesce(new.componentes_por_persona, '[]'::jsonb)) with ordinality persona(value, ordinality);
    new.servicios_json := new.componentes_por_persona;
  end if;
  return new;
end;
$$;

drop trigger if exists caja_preparar_cita_catalog_metadata on public.citas_reservadas;
create trigger caja_preparar_cita_catalog_metadata
before insert on public.citas_reservadas
for each row execute function public.caja_preparar_cita_catalog_metadata_v1();

revoke all on function public.caja_catalog_active_services_read_v1() from public, anon, authenticated;
revoke all on function public.caja_catalog_home_policy_read_v1() from public, anon, authenticated;
revoke all on function public.caja_catalog_resolve_appointment_v1(jsonb, integer, text) from public, anon, authenticated;
revoke all on public.caja_catalog_active_services_legacy_shape_v1 from public, anon, authenticated, service_role;
revoke all on function public.caja_preparar_cita_catalog_metadata_v1() from public, anon, authenticated;
grant execute on function public.caja_catalog_active_services_read_v1() to service_role;
grant execute on function public.caja_catalog_home_policy_read_v1() to service_role;
grant execute on function public.caja_catalog_resolve_appointment_v1(jsonb, integer, text) to service_role;

commit;

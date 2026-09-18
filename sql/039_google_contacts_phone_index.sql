-- 039 · Índice local de Google Contacts para deduplicación segura.
-- Requiere 034–038.
--
-- Problema que resuelve:
-- - Google Contacts / People API search no es exhaustivo por teléfono.
-- - Get Many/Return All en cada sync puede disparar rate limits.
-- - public.clientes sigue siendo el maestro; este índice solo representa
--   identidad externa para evitar crear contactos duplicados.
--
-- Flujo objetivo:
-- bootstrap incremental Google Contacts -> batch_v1(snapshot_token, contacts)
-- -> google_contact_resources + google_contact_phones
-- worker outbox -> lookup_phone_v1(E.164)
--   0 matches: create contact + indexar resource
--   1 match: adoptar/update resource
--   >1 matches: revisión/manual; nunca crear otro contacto.

create table if not exists public.google_contact_resources (
  resource_name text primary key,
  display_name text,
  email text,
  etag text,
  source_updated_at timestamptz,
  last_snapshot_token text,
  last_seen_at timestamptz not null default now(),
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_google_contact_resource_name
    check (resource_name ~ '^people/[A-Za-z0-9._-]+$')
);

create table if not exists public.google_contact_phones (
  resource_name text not null
    references public.google_contact_resources(resource_name)
    on update cascade on delete cascade,
  phone_e164 text not null,
  phone_raw text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (resource_name, phone_e164),
  constraint chk_google_contact_phone_e164
    check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);

create index if not exists idx_google_contact_phones_e164
  on public.google_contact_phones (phone_e164, resource_name);

create index if not exists idx_google_contact_resources_snapshot
  on public.google_contact_resources (last_snapshot_token, deleted, resource_name);

create table if not exists public.google_contacts_index_state (
  singleton boolean primary key default true,
  bootstrap_ready boolean not null default false,
  last_snapshot_token text,
  last_snapshot_completed_at timestamptz,
  last_snapshot_contacts integer not null default 0,
  last_snapshot_phones integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint chk_google_contacts_index_state_singleton check (singleton)
);

insert into public.google_contacts_index_state (singleton)
values (true)
on conflict (singleton) do nothing;

alter table public.google_contact_resources enable row level security;
alter table public.google_contact_phones enable row level security;
alter table public.google_contacts_index_state enable row level security;

revoke all on table public.google_contact_resources from anon, authenticated;
revoke all on table public.google_contact_phones from anon, authenticated;
revoke all on table public.google_contacts_index_state from anon, authenticated;
grant all on table public.google_contact_resources to service_role;
grant all on table public.google_contact_phones to service_role;
grant all on table public.google_contacts_index_state to service_role;

create or replace function public.caja_google_contacts_index_batch_v1(
  p_snapshot_token text,
  p_contacts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot text := nullif(btrim(p_snapshot_token), '');
  v_contact jsonb;
  v_resource text;
  v_display text;
  v_email text;
  v_etag text;
  v_source_updated_at timestamptz;
  v_phone jsonb;
  v_phone_raw text;
  v_phone_e164 text;
  v_contacts_seen integer := 0;
  v_phones_indexed integer := 0;
begin
  if v_snapshot is null then
    raise exception 'CAJA_GOOGLE_CONTACTS_SNAPSHOT_TOKEN_REQUIRED';
  end if;

  if p_contacts is null
     or jsonb_typeof(p_contacts) <> 'array' then
    raise exception 'CAJA_GOOGLE_CONTACTS_CONTACTS_ARRAY_REQUIRED';
  end if;

  for v_contact in
    select value from jsonb_array_elements(p_contacts)
  loop
    v_resource := nullif(btrim(v_contact->>'resource_name'), '');
    if v_resource is null or v_resource !~ '^people/[A-Za-z0-9._-]+$' then
      raise exception 'CAJA_GOOGLE_CONTACTS_RESOURCE_INVALID';
    end if;

    v_display := nullif(btrim(v_contact->>'display_name'), '');
    v_email := nullif(lower(btrim(v_contact->>'email')), '');
    v_etag := nullif(btrim(v_contact->>'etag'), '');

    begin
      v_source_updated_at := nullif(btrim(v_contact->>'source_updated_at'), '')::timestamptz;
    exception when others then
      v_source_updated_at := null;
    end;

    insert into public.google_contact_resources (
      resource_name,
      display_name,
      email,
      etag,
      source_updated_at,
      last_snapshot_token,
      last_seen_at,
      deleted,
      updated_at
    ) values (
      v_resource,
      v_display,
      v_email,
      v_etag,
      v_source_updated_at,
      v_snapshot,
      now(),
      false,
      now()
    )
    on conflict (resource_name) do update set
      display_name = excluded.display_name,
      email = excluded.email,
      etag = excluded.etag,
      source_updated_at = excluded.source_updated_at,
      last_snapshot_token = excluded.last_snapshot_token,
      last_seen_at = now(),
      deleted = false,
      updated_at = now();

    -- Reemplazo completo de teléfonos del recurso para no conservar números viejos.
    delete from public.google_contact_phones
    where resource_name = v_resource;

    if jsonb_typeof(v_contact->'phones') = 'array' then
      for v_phone in
        select value from jsonb_array_elements(v_contact->'phones')
      loop
        if jsonb_typeof(v_phone) = 'string' then
          v_phone_raw := trim(both '"' from v_phone::text);
          v_phone_e164 := v_phone_raw;
        else
          v_phone_raw := nullif(btrim(v_phone->>'raw'), '');
          v_phone_e164 := nullif(btrim(v_phone->>'e164'), '');
        end if;

        if v_phone_e164 is not null
           and v_phone_e164 ~ '^\+[1-9][0-9]{7,14}$' then
          insert into public.google_contact_phones (
            resource_name, phone_e164, phone_raw, updated_at
          ) values (
            v_resource, v_phone_e164, v_phone_raw, now()
          )
          on conflict (resource_name, phone_e164) do update set
            phone_raw = excluded.phone_raw,
            updated_at = now();

          v_phones_indexed := v_phones_indexed + 1;
        end if;
      end loop;
    end if;

    v_contacts_seen := v_contacts_seen + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'snapshot_token', v_snapshot,
    'contacts_seen', v_contacts_seen,
    'phones_indexed', v_phones_indexed
  );
end;
$$;

revoke all on function public.caja_google_contacts_index_batch_v1(text,jsonb)
  from public, anon, authenticated;
grant execute on function public.caja_google_contacts_index_batch_v1(text,jsonb)
  to service_role;

create or replace function public.caja_google_contacts_index_finish_snapshot_v1(
  p_snapshot_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot text := nullif(btrim(p_snapshot_token), '');
  v_deleted integer := 0;
begin
  if v_snapshot is null then
    raise exception 'CAJA_GOOGLE_CONTACTS_SNAPSHOT_TOKEN_REQUIRED';
  end if;

  update public.google_contact_resources
  set deleted = true,
      updated_at = now()
  where deleted = false
    and last_snapshot_token is distinct from v_snapshot;

  get diagnostics v_deleted = row_count;

  update public.google_contacts_index_state
  set bootstrap_ready = true,
      last_snapshot_token = v_snapshot,
      last_snapshot_completed_at = now(),
      last_snapshot_contacts = (
        select count(*)::integer
        from public.google_contact_resources
        where deleted = false
      ),
      last_snapshot_phones = (
        select count(*)::integer
        from public.google_contact_phones p
        join public.google_contact_resources r using (resource_name)
        where r.deleted = false
      ),
      updated_at = now()
  where singleton = true;

  return jsonb_build_object(
    'ok', true,
    'snapshot_token', v_snapshot,
    'marked_deleted', v_deleted,
    'bootstrap_ready', true,
    'active_contacts', (
      select count(*) from public.google_contact_resources where deleted = false
    ),
    'active_phones', (
      select count(*)
      from public.google_contact_phones p
      join public.google_contact_resources r using (resource_name)
      where r.deleted = false
    )
  );
end;
$$;

revoke all on function public.caja_google_contacts_index_finish_snapshot_v1(text)
  from public, anon, authenticated;
grant execute on function public.caja_google_contacts_index_finish_snapshot_v1(text)
  to service_role;

create or replace function public.caja_google_contacts_lookup_phone_v1(
  p_phone_e164 text
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with normalized as (
    select nullif(btrim(p_phone_e164), '') as phone_e164
  ),
  matches as (
    select
      r.resource_name,
      r.display_name,
      r.email,
      r.etag,
      r.source_updated_at,
      p.phone_e164
    from normalized n
    join public.google_contact_phones p
      on p.phone_e164 = n.phone_e164
    join public.google_contact_resources r
      on r.resource_name = p.resource_name
    where r.deleted = false
      and n.phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
    order by r.resource_name
  )
  select jsonb_build_object(
    'ok', true,
    'phone_e164', (select phone_e164 from normalized),
    'match_count', (select count(*) from matches),
    'matches', coalesce(
      (select jsonb_agg(to_jsonb(matches) order by resource_name) from matches),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.caja_google_contacts_lookup_phone_v1(text)
  from public, anon, authenticated;
grant execute on function public.caja_google_contacts_lookup_phone_v1(text)
  to service_role;

create or replace function public.caja_google_contacts_index_status_v1()
returns jsonb
language sql
security definer
set search_path = public
as $
  select jsonb_build_object(
    'ok', true,
    'bootstrap_ready', bootstrap_ready,
    'last_snapshot_token', last_snapshot_token,
    'last_snapshot_completed_at', last_snapshot_completed_at,
    'last_snapshot_contacts', last_snapshot_contacts,
    'last_snapshot_phones', last_snapshot_phones
  )
  from public.google_contacts_index_state
  where singleton = true;
$;

revoke all on function public.caja_google_contacts_index_status_v1()
  from public, anon, authenticated;
grant execute on function public.caja_google_contacts_index_status_v1()
  to service_role;

create or replace function public.caja_contact_sync_claim_v3(
  p_limit integer default 10,
  p_lease_seconds integer default 300
)
returns table (
  sync_id bigint,
  processing_token text,
  cliente_id text,
  cliente text,
  whatsapp_e164 text,
  email text,
  fecha_nacimiento date,
  resource_name text,
  attempts integer,
  payload_hash text
)
language plpgsql
security definer
set search_path = public
as $
begin
  if not exists (
    select 1
    from public.google_contacts_index_state
    where singleton = true
      and bootstrap_ready = true
  ) then
    return;
  end if;

  return query
  select *
  from public.caja_contact_sync_claim_v2(p_limit, p_lease_seconds);
end;
$;

revoke all on function public.caja_contact_sync_claim_v3(integer,integer)
  from public, anon, authenticated;
grant execute on function public.caja_contact_sync_claim_v3(integer,integer)
  to service_role;

create or replace function public.caja_contact_sync_finish_v3(
  p_sync_id bigint,
  p_processing_token text,
  p_ok boolean,
  p_resource_name text default null,
  p_error text default null,
  p_retry_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $
declare
  v_result jsonb;
  v_cliente public.clientes%rowtype;
  v_resource text := nullif(btrim(p_resource_name), '');
begin
  v_result := public.caja_contact_sync_finish_v2(
    p_sync_id,
    p_processing_token,
    p_ok,
    p_resource_name,
    p_error,
    p_retry_seconds
  );

  if coalesce((v_result->>'ok')::boolean, false) = true
     and v_result->>'status' = 'FINISHED'
     and p_ok = true
     and v_resource is not null then

    select c.* into v_cliente
    from public.cliente_contact_sync_outbox o
    join public.clientes c on c.cliente_id = o.cliente_id
    where o.sync_id = p_sync_id;

    if v_cliente.cliente_id is not null
       and v_cliente.telefono_estado = 'CANONICO'
       and v_cliente.whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}
-- 2) batch del mismo resource con teléfono distinto => teléfono anterior desaparece.
-- 3) finish snapshot marca deleted recursos no vistos; lookup ya no los devuelve.
-- 4) anon/authenticated sin permisos; service_role sí.
 then

      perform public.caja_google_contacts_index_batch_v1(
        'WORKER:' || p_sync_id::text,
        jsonb_build_array(
          jsonb_build_object(
            'resource_name', v_resource,
            'display_name', v_cliente.cliente,
            'email', nullif(lower(btrim(v_cliente.email)), ''),
            'phones', jsonb_build_array(
              jsonb_build_object(
                'e164', v_cliente.whatsapp_e164,
                'raw', coalesce(nullif(btrim(v_cliente.whatsapp), ''), v_cliente.whatsapp_e164)
              )
            )
          )
        )
      );
    end if;
  end if;

  return v_result;
end;
$;

revoke all on function public.caja_contact_sync_finish_v3(bigint,text,boolean,text,text,integer)
  from public, anon, authenticated;
grant execute on function public.caja_contact_sync_finish_v3(bigint,text,boolean,text,text,integer)
  to service_role;

-- QA mínimo:
-- 1) batch con dos resource_name distintos y mismo E.164 => lookup match_count=2.
-- 2) batch del mismo resource con teléfono distinto => teléfono anterior desaparece.
-- 3) finish snapshot marca deleted recursos no vistos; lookup ya no los devuelve.
-- 4) anon/authenticated sin permisos; service_role sí.

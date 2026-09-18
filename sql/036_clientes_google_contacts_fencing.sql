-- 036 · Fencing token para el worker de Google Contacts.
-- Requiere 034 + 035.
--
-- Un lease sin token no impide que un worker vencido complete tarde una fila
-- que ya fue reclamada por otro worker. v2 agrega processing_token y hace que
-- finish solo acepte al claim vigente.

alter table public.cliente_contact_sync_outbox
  add column if not exists processing_token text;

-- v1 deja de ser parte del contrato operativo para evitar completion sin fencing.
revoke execute on function public.caja_contact_sync_claim_v1(integer,integer) from service_role;
revoke execute on function public.caja_contact_sync_finish_v1(bigint,boolean,text,text,integer) from service_role;

create or replace function public.caja_contact_sync_claim_v2(
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
as $$
begin
  return query
  with candidatos as (
    select o.sync_id
    from public.cliente_contact_sync_outbox o
    join public.clientes c on c.cliente_id = o.cliente_id
    where (
      o.estado in ('PENDING','FAILED')
      or (o.estado = 'PROCESSING' and o.lease_until < now())
    )
      and (o.next_retry_at is null or o.next_retry_at <= now())
      and (o.lease_until is null or o.lease_until < now())
      and c.telefono_estado = 'CANONICO'
      and c.whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$'
    order by o.updated_at, o.sync_id
    for update of o skip locked
    limit least(greatest(coalesce(p_limit, 10), 1), 100)
  ), reclamados as (
    update public.cliente_contact_sync_outbox o
    set estado = 'PROCESSING',
        attempts = o.attempts + 1,
        processing_token = md5(
          o.sync_id::text || ':' ||
          clock_timestamp()::text || ':' ||
          random()::text || ':' ||
          o.attempts::text
        ),
        lease_until = now() + make_interval(
          secs => least(greatest(coalesce(p_lease_seconds, 300), 30), 1800)
        ),
        updated_at = now()
    from candidatos c
    where o.sync_id = c.sync_id
    returning o.*
  )
  select
    r.sync_id,
    r.processing_token,
    r.cliente_id,
    c.cliente,
    c.whatsapp_e164,
    c.email,
    c.fecha_nacimiento,
    r.resource_name,
    r.attempts,
    r.payload_hash
  from reclamados r
  join public.clientes c on c.cliente_id = r.cliente_id
  order by r.sync_id;
end;
$$;

revoke all on function public.caja_contact_sync_claim_v2(integer,integer)
  from public, anon, authenticated;
grant execute on function public.caja_contact_sync_claim_v2(integer,integer)
  to service_role;

create or replace function public.caja_contact_sync_finish_v2(
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
as $$
declare
  v_row public.cliente_contact_sync_outbox%rowtype;
begin
  if nullif(btrim(p_processing_token), '') is null then
    raise exception 'CAJA_CONTACT_SYNC_TOKEN_REQUIRED';
  end if;

  select * into v_row
  from public.cliente_contact_sync_outbox
  where sync_id = p_sync_id
  for update;

  if v_row.sync_id is null then
    raise exception 'CAJA_CONTACT_SYNC_NOT_FOUND';
  end if;

  if v_row.estado <> 'PROCESSING'
     or v_row.processing_token is distinct from p_processing_token then
    return jsonb_build_object(
      'ok', false,
      'status', 'STALE_CLAIM',
      'sync_id', v_row.sync_id,
      'cliente_id', v_row.cliente_id,
      'estado', v_row.estado,
      'attempts', v_row.attempts
    );
  end if;

  if p_ok then
    update public.cliente_contact_sync_outbox
    set estado = 'SUCCEEDED',
        resource_name = coalesce(nullif(btrim(p_resource_name), ''), resource_name),
        processing_token = null,
        lease_until = null,
        next_retry_at = null,
        last_error = null,
        last_synced_at = now(),
        updated_at = now()
    where sync_id = p_sync_id
      and processing_token = p_processing_token;
  else
    update public.cliente_contact_sync_outbox
    set estado = case when attempts >= 5 then 'DEAD' else 'FAILED' end,
        processing_token = null,
        lease_until = null,
        next_retry_at = case
          when attempts >= 5 then null
          else now() + make_interval(
            secs => least(greatest(coalesce(p_retry_seconds, 300), 60), 86400)
          )
        end,
        last_error = left(coalesce(p_error, 'GOOGLE_CONTACTS_SYNC_FAILED'), 2000),
        updated_at = now()
    where sync_id = p_sync_id
      and processing_token = p_processing_token;
  end if;

  select * into v_row
  from public.cliente_contact_sync_outbox
  where sync_id = p_sync_id;

  return jsonb_build_object(
    'ok', true,
    'status', 'FINISHED',
    'sync_id', v_row.sync_id,
    'cliente_id', v_row.cliente_id,
    'estado', v_row.estado,
    'attempts', v_row.attempts,
    'next_retry_at', v_row.next_retry_at,
    'resource_name', v_row.resource_name
  );
end;
$$;

revoke all on function public.caja_contact_sync_finish_v2(bigint,text,boolean,text,text,integer)
  from public, anon, authenticated;
grant execute on function public.caja_contact_sync_finish_v2(bigint,text,boolean,text,text,integer)
  to service_role;

-- QA requerido:
-- A reclama token A; vence lease; B reclama token B; finish(A) => STALE_CLAIM;
-- finish(B) => FINISHED.

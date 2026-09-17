-- 035 · Hardening de ingesta de formulario y claim de Google Contacts.
-- Complementa 034 antes de cualquier despliegue.
--
-- 1) El worker solo reclama filas cuyo cliente SIGUE siendo CANONICO.
-- 2) n8n dispone de una RPC explícita para persistir fallos de ingesta aunque
--    la RPC principal haya abortado y revertido su propia transacción.

create or replace function public.caja_cliente_form_mark_failed_v1(
  p_source_record_id text,
  p_source_sheet text default null,
  p_source_row integer default null,
  p_error_code text default 'INGEST_FAILED',
  p_error_detail text default null,
  p_raw_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_record_id text := nullif(btrim(p_source_record_id), '');
  v_row public.cliente_form_ingestas%rowtype;
begin
  if v_source_record_id is null then
    raise exception 'CAJA_FORM_SOURCE_ID_REQUIRED';
  end if;

  insert into public.cliente_form_ingestas (
    source_system,
    source_record_id,
    source_sheet,
    source_row,
    payload_hash,
    raw_payload,
    telefono_estado,
    estado,
    error_code,
    error_detail,
    attempts,
    processed_at,
    updated_at
  ) values (
    'GOOGLE_FORM',
    v_source_record_id,
    nullif(btrim(p_source_sheet), ''),
    p_source_row,
    md5(coalesce(p_raw_payload, '{}'::jsonb)::text),
    coalesce(p_raw_payload, '{}'::jsonb),
    'PENDIENTE_REVISION',
    'FAILED',
    coalesce(nullif(btrim(p_error_code), ''), 'INGEST_FAILED'),
    left(coalesce(p_error_detail, 'Error de ingesta no especificado'), 1000),
    1,
    now(),
    now()
  )
  on conflict (source_system, source_record_id) do update set
    source_sheet = coalesce(excluded.source_sheet, public.cliente_form_ingestas.source_sheet),
    source_row = coalesce(excluded.source_row, public.cliente_form_ingestas.source_row),
    payload_hash = excluded.payload_hash,
    raw_payload = excluded.raw_payload,
    estado = 'FAILED',
    error_code = excluded.error_code,
    error_detail = excluded.error_detail,
    attempts = public.cliente_form_ingestas.attempts + 1,
    processed_at = now(),
    updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'ok', false,
    'estado', v_row.estado,
    'source_record_id', v_row.source_record_id,
    'attempts', v_row.attempts,
    'error_code', v_row.error_code
  );
end;
$$;

revoke all on function public.caja_cliente_form_mark_failed_v1(text,text,integer,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.caja_cliente_form_mark_failed_v1(text,text,integer,text,text,jsonb)
  to service_role;

create or replace function public.caja_contact_sync_claim_v1(
  p_limit integer default 10,
  p_lease_seconds integer default 300
)
returns table (
  sync_id bigint,
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

revoke all on function public.caja_contact_sync_claim_v1(integer,integer)
  from public, anon, authenticated;
grant execute on function public.caja_contact_sync_claim_v1(integer,integer)
  to service_role;

-- Nota operativa:
-- n8n debe invocar caja_cliente_form_mark_failed_v1() cuando la llamada a
-- caja_ingestar_cliente_form_v1() termine con error SQL/HTTP. No debe confiar
-- en el handler interno de 034 para persistir un fallo si la transacción aborta.

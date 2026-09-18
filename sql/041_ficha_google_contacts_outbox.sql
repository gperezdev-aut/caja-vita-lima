-- 041 · Ficha de cita -> outbox de Google Contacts.
--
-- Objetivo:
-- - cuando una ficha pasa a estado_ficha='completa', encolar al cliente para
--   sincronización con Google Contacts;
-- - no duplicar trabajos si el payload no cambió;
-- - preservar resource_name ya adoptado;
-- - no interferir con un worker PROCESSING cuando el payload no cambió;
-- - invalidar de forma segura un claim en curso si la ficha cambió el payload.
--
-- Requiere 034_clientes_form_google_contacts_sync.sql y
-- 036_clientes_google_contacts_fencing.sql.

create or replace function public.caja_contact_sync_enqueue_cliente_v1(
  p_cliente_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente public.clientes%rowtype;
  v_outbox public.cliente_contact_sync_outbox%rowtype;
  v_hash text;
  v_rows integer := 0;
begin
  if nullif(btrim(p_cliente_id), '') is null then
    return jsonb_build_object(
      'ok', true,
      'enqueued', false,
      'decision', 'CLIENTE_ID_VACIO'
    );
  end if;

  select *
  into v_cliente
  from public.clientes
  where cliente_id = btrim(p_cliente_id);

  if v_cliente.cliente_id is null then
    return jsonb_build_object(
      'ok', true,
      'enqueued', false,
      'decision', 'CLIENTE_NO_EXISTE'
    );
  end if;

  if v_cliente.telefono_estado <> 'CANONICO'
     or v_cliente.whatsapp_e164 is null
     or v_cliente.whatsapp_e164 !~ '^\+[1-9][0-9]{7,14}$' then
    return jsonb_build_object(
      'ok', true,
      'enqueued', false,
      'decision', 'TELEFONO_NO_CANONICO',
      'cliente_id', v_cliente.cliente_id
    );
  end if;

  v_hash := md5(concat_ws('|',
    coalesce(v_cliente.cliente, ''),
    coalesce(v_cliente.whatsapp_e164, ''),
    coalesce(v_cliente.email, ''),
    coalesce(v_cliente.fecha_nacimiento::text, '')
  ));

  -- Serializa enqueues explícitos del mismo cliente. Un worker ya reclamado
  -- queda protegido adicionalmente por processing_token/fencing.
  perform pg_advisory_xact_lock(
    hashtextextended('CONTACT_SYNC:' || v_cliente.cliente_id, 0)
  );

  insert into public.cliente_contact_sync_outbox (
    cliente_id,
    provider,
    estado,
    payload_hash,
    attempts,
    processing_token,
    lease_until,
    next_retry_at,
    last_error,
    updated_at
  ) values (
    v_cliente.cliente_id,
    'GOOGLE_CONTACTS',
    'PENDING',
    v_hash,
    0,
    null,
    null,
    null,
    null,
    now()
  )
  on conflict (cliente_id, provider) do nothing;

  get diagnostics v_rows = row_count;

  if v_rows = 1 then
    return jsonb_build_object(
      'ok', true,
      'enqueued', true,
      'decision', 'INSERTED',
      'cliente_id', v_cliente.cliente_id
    );
  end if;

  select *
  into v_outbox
  from public.cliente_contact_sync_outbox
  where cliente_id = v_cliente.cliente_id
    and provider = 'GOOGLE_CONTACTS'
  for update;

  if v_outbox.payload_hash is distinct from v_hash then
    update public.cliente_contact_sync_outbox
    set payload_hash = v_hash,
        estado = 'PENDING',
        attempts = 0,
        processing_token = null,
        lease_until = null,
        next_retry_at = null,
        last_error = null,
        updated_at = now()
    where sync_id = v_outbox.sync_id;

    return jsonb_build_object(
      'ok', true,
      'enqueued', true,
      'decision', 'UPDATED_PAYLOAD',
      'cliente_id', v_cliente.cliente_id,
      'sync_id', v_outbox.sync_id
    );
  end if;

  if v_outbox.estado in ('FAILED', 'DEAD', 'SKIPPED') then
    update public.cliente_contact_sync_outbox
    set estado = 'PENDING',
        attempts = 0,
        processing_token = null,
        lease_until = null,
        next_retry_at = null,
        last_error = null,
        updated_at = now()
    where sync_id = v_outbox.sync_id;

    return jsonb_build_object(
      'ok', true,
      'enqueued', true,
      'decision', 'REQUEUED',
      'cliente_id', v_cliente.cliente_id,
      'sync_id', v_outbox.sync_id
    );
  end if;

  -- PENDING / PROCESSING / SUCCEEDED con el mismo payload no se toca.
  -- En particular, PROCESSING conserva lease y processing_token vigentes.
  return jsonb_build_object(
    'ok', true,
    'enqueued', false,
    'decision', 'NO_CHANGE',
    'cliente_id', v_cliente.cliente_id,
    'sync_id', v_outbox.sync_id,
    'estado', v_outbox.estado
  );
end;
$$;

revoke all on function public.caja_contact_sync_enqueue_cliente_v1(text)
  from public, anon, authenticated;
grant execute on function public.caja_contact_sync_enqueue_cliente_v1(text)
  to service_role;

create or replace function public.caja_ficha_enqueue_google_contact_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.cliente_id is not null then
    perform public.caja_contact_sync_enqueue_cliente_v1(new.cliente_id);
  end if;
  return new;
end;
$$;

revoke all on function public.caja_ficha_enqueue_google_contact_v1()
  from public, anon, authenticated;

drop trigger if exists trg_citas_reservadas_contact_sync_on_ficha_complete_v1
  on public.citas_reservadas;

create trigger trg_citas_reservadas_contact_sync_on_ficha_complete_v1
after update of estado_ficha on public.citas_reservadas
for each row
when (
  new.estado_ficha = 'completa'
  and old.estado_ficha is distinct from 'completa'
)
execute function public.caja_ficha_enqueue_google_contact_v1();

-- Post-check:
-- select pg_get_triggerdef(oid)
-- from pg_trigger
-- where tgname = 'trg_citas_reservadas_contact_sync_on_ficha_complete_v1';

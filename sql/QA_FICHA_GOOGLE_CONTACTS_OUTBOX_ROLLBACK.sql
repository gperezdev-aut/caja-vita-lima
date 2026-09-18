-- QA 041 · Ficha completa -> outbox Google Contacts.
-- Ejecutar sobre PostgreSQL aislado con 041 aplicada.
-- Todo se revierte.

begin;

insert into public.clientes (
  cliente_id, cliente, whatsapp_e164, email, fecha_nacimiento, telefono_estado
) values (
  'CLI-QA-041-1',
  'Cliente QA Ficha',
  '+51987654041',
  'qa041@example.com',
  date '1990-01-02',
  'CANONICO'
);

insert into public.citas_reservadas (
  reserva_id, cliente_id, estado_ficha
) values (
  'RES-QA-041-1',
  'CLI-QA-041-1',
  'pendiente'
);

-- Primera ficha completa: crea outbox PENDING.
update public.citas_reservadas
set estado_ficha = 'completa'
where reserva_id = 'RES-QA-041-1';

do $$
declare
  v public.cliente_contact_sync_outbox%rowtype;
begin
  select * into v
  from public.cliente_contact_sync_outbox
  where cliente_id='CLI-QA-041-1'
    and provider='GOOGLE_CONTACTS';

  if v.sync_id is null
     or v.estado <> 'PENDING'
     or v.attempts <> 0
     or v.resource_name is not null then
    raise exception 'QA041_FIRST_ENQUEUE_FAILED';
  end if;
end $$;

-- Si ya sincronizó y el payload no cambió, otra ficha no debe reencolar.
update public.cliente_contact_sync_outbox
set estado='SUCCEEDED',
    resource_name='people/cQA041',
    attempts=1,
    last_synced_at=now(),
    updated_at=now()
where cliente_id='CLI-QA-041-1';

update public.citas_reservadas
set estado_ficha='pendiente'
where reserva_id='RES-QA-041-1';

update public.citas_reservadas
set estado_ficha='completa'
where reserva_id='RES-QA-041-1';

do $$
declare
  v public.cliente_contact_sync_outbox%rowtype;
begin
  select * into v
  from public.cliente_contact_sync_outbox
  where cliente_id='CLI-QA-041-1';

  if v.estado <> 'SUCCEEDED'
     or v.resource_name <> 'people/cQA041'
     or v.attempts <> 1 then
    raise exception 'QA041_UNCHANGED_REENQUEUE_FAILED';
  end if;
end $$;

-- Cambio real de ficha: debe volver a PENDING y preservar resource_name.
update public.clientes
set email='qa041-updated@example.com'
where cliente_id='CLI-QA-041-1';

update public.citas_reservadas
set estado_ficha='pendiente'
where reserva_id='RES-QA-041-1';

update public.citas_reservadas
set estado_ficha='completa'
where reserva_id='RES-QA-041-1';

do $$
declare
  v public.cliente_contact_sync_outbox%rowtype;
begin
  select * into v
  from public.cliente_contact_sync_outbox
  where cliente_id='CLI-QA-041-1';

  if v.estado <> 'PENDING'
     or v.resource_name <> 'people/cQA041'
     or v.attempts <> 0
     or v.processing_token is not null
     or v.lease_until is not null then
    raise exception 'QA041_CHANGED_PAYLOAD_FAILED';
  end if;
end $$;

-- Mismo payload mientras PROCESSING: no tocar token ni lease.
update public.cliente_contact_sync_outbox
set estado='PROCESSING',
    attempts=1,
    processing_token='TOKEN-QA-041',
    lease_until=now()+interval '5 minutes',
    updated_at=now()
where cliente_id='CLI-QA-041-1';

select public.caja_contact_sync_enqueue_cliente_v1('CLI-QA-041-1');

do $$
declare
  v public.cliente_contact_sync_outbox%rowtype;
begin
  select * into v
  from public.cliente_contact_sync_outbox
  where cliente_id='CLI-QA-041-1';

  if v.estado <> 'PROCESSING'
     or v.processing_token <> 'TOKEN-QA-041'
     or v.lease_until is null then
    raise exception 'QA041_PROCESSING_SAME_PAYLOAD_FAILED';
  end if;
end $$;

-- Si el payload cambia durante PROCESSING, se invalida el claim vigente.
update public.clientes
set cliente='Cliente QA Ficha Actualizado'
where cliente_id='CLI-QA-041-1';

select public.caja_contact_sync_enqueue_cliente_v1('CLI-QA-041-1');

do $$
declare
  v public.cliente_contact_sync_outbox%rowtype;
begin
  select * into v
  from public.cliente_contact_sync_outbox
  where cliente_id='CLI-QA-041-1';

  if v.estado <> 'PENDING'
     or v.processing_token is not null
     or v.lease_until is not null
     or v.resource_name <> 'people/cQA041'
     or v.attempts <> 0 then
    raise exception 'QA041_PROCESSING_CHANGED_PAYLOAD_FAILED';
  end if;
end $$;

-- Teléfono no canónico: la ficha completa no genera outbox.
insert into public.clientes (
  cliente_id, cliente, whatsapp_e164, email, fecha_nacimiento, telefono_estado
) values (
  'CLI-QA-041-2',
  'Cliente QA No Canonico',
  '+51911111041',
  null,
  null,
  'PENDIENTE_REVISION'
);

insert into public.citas_reservadas (
  reserva_id, cliente_id, estado_ficha
) values (
  'RES-QA-041-2',
  'CLI-QA-041-2',
  'pendiente'
);

update public.citas_reservadas
set estado_ficha='completa'
where reserva_id='RES-QA-041-2';

do $$
begin
  if exists (
    select 1
    from public.cliente_contact_sync_outbox
    where cliente_id='CLI-QA-041-2'
  ) then
    raise exception 'QA041_NON_CANONICAL_ENQUEUED';
  end if;
end $$;

-- El trigger debe existir exactamente sobre citas_reservadas.
do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid='public.citas_reservadas'::regclass
      and tgname='trg_citas_reservadas_contact_sync_on_ficha_complete_v1'
      and not tgisinternal
  ) then
    raise exception 'QA041_TRIGGER_MISSING';
  end if;
end $$;

rollback;

select 'FICHA_GOOGLE_CONTACTS_OUTBOX_QA_OK' as result;

-- 037 · Hardening de identidad e ingesta concurrente del Google Form.
-- Requiere 034 + 035 + 036.
--
-- Corrige tres bordes detectados en QA antes de producción:
-- 1) una source_record_id ya vinculada no puede cambiar silenciosamente de cliente/E.164;
-- 2) un E.164 existente con DNI/email contradictorios va a revisión, no a SUCCEEDED;
-- 3) ingestas concurrentes del mismo E.164 se serializan con advisory xact lock.

create or replace function public.caja_ingestar_cliente_form_v1(
  p_source_record_id text,
  p_source_sheet text,
  p_source_row integer,
  p_source_submitted_at timestamptz,
  p_cliente_nombre text,
  p_whatsapp_raw text,
  p_whatsapp_e164 text,
  p_pais_telefono text,
  p_telefono_estado text,
  p_dni text default null,
  p_email text default null,
  p_fecha_nacimiento date default null,
  p_raw_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_record_id text := nullif(btrim(p_source_record_id), '');
  v_nombre text := nullif(btrim(p_cliente_nombre), '');
  v_whatsapp_raw text := nullif(btrim(p_whatsapp_raw), '');
  v_e164 text := nullif(btrim(p_whatsapp_e164), '');
  v_pais text := nullif(upper(btrim(p_pais_telefono)), '');
  v_dni text := nullif(btrim(p_dni), '');
  v_email text := nullif(lower(btrim(p_email)), '');
  v_tel_estado text := coalesce(nullif(upper(btrim(p_telefono_estado)), ''), 'PENDIENTE_REVISION');
  v_payload_hash text := md5(coalesce(p_raw_payload, '{}'::jsonb)::text);
  v_previa public.cliente_form_ingestas%rowtype;
  v_ingesta public.cliente_form_ingestas%rowtype;
  v_cliente public.clientes%rowtype;
  v_cliente_previo public.clientes%rowtype;
  v_conflicto_id text;
  v_cliente_id text;
  v_contact_hash text;
  v_dni_actual text;
  v_email_actual text;
begin
  if v_source_record_id is null then
    raise exception 'CAJA_FORM_SOURCE_ID_REQUIRED';
  end if;

  -- Bloquea la misma respuesta si llega concurrentemente.
  select * into v_previa
  from public.cliente_form_ingestas
  where source_system = 'GOOGLE_FORM'
    and source_record_id = v_source_record_id
  for update;

  -- Una respuesta ya ligada a un maestro no puede ser editada para apuntar a
  -- otro teléfono/cliente sin revisión manual. Evita duplicar identidad por
  -- cambios posteriores en la hoja técnica.
  if v_previa.ingesta_id is not null
     and v_previa.cliente_id is not null
     and v_previa.payload_hash is distinct from v_payload_hash then
    select * into v_cliente_previo
    from public.clientes
    where cliente_id = v_previa.cliente_id;

    if v_e164 is distinct from v_cliente_previo.whatsapp_e164 then
      update public.cliente_form_ingestas
      set source_sheet = coalesce(nullif(btrim(p_source_sheet), ''), source_sheet),
          source_row = coalesce(p_source_row, source_row),
          source_submitted_at = coalesce(p_source_submitted_at, source_submitted_at),
          payload_hash = v_payload_hash,
          raw_payload = coalesce(p_raw_payload, '{}'::jsonb),
          cliente_nombre = v_nombre,
          whatsapp_raw = v_whatsapp_raw,
          whatsapp_e164 = v_e164,
          pais_telefono = v_pais,
          telefono_estado = v_tel_estado,
          dni = v_dni,
          email = v_email,
          fecha_nacimiento = p_fecha_nacimiento,
          estado = 'PENDIENTE_REVISION',
          decision = 'SOURCE_IDENTITY_CHANGED',
          error_code = 'SOURCE_RECORD_LINKED_OTHER_WHATSAPP',
          error_detail = 'La misma respuesta ya estaba ligada a otro cliente/E.164; no se cambia identidad automáticamente.',
          attempts = attempts + 1,
          processed_at = now(),
          updated_at = now()
      where ingesta_id = v_previa.ingesta_id
      returning * into v_ingesta;

      return jsonb_build_object(
        'ok', true,
        'estado', 'PENDIENTE_REVISION',
        'decision', 'SOURCE_IDENTITY_CHANGED',
        'cliente_id', v_previa.cliente_id,
        'contacts_enqueued', false
      );
    end if;
  end if;

  insert into public.cliente_form_ingestas (
    source_system, source_record_id, source_sheet, source_row, source_submitted_at,
    payload_hash, raw_payload, cliente_nombre, whatsapp_raw, whatsapp_e164,
    pais_telefono, telefono_estado, dni, email, fecha_nacimiento,
    estado, attempts, updated_at
  ) values (
    'GOOGLE_FORM', v_source_record_id, nullif(btrim(p_source_sheet), ''), p_source_row,
    p_source_submitted_at, v_payload_hash, coalesce(p_raw_payload, '{}'::jsonb),
    v_nombre, v_whatsapp_raw, v_e164, v_pais, v_tel_estado, v_dni, v_email,
    p_fecha_nacimiento, 'PROCESSING', 1, now()
  )
  on conflict (source_system, source_record_id) do update set
    source_sheet = excluded.source_sheet,
    source_row = excluded.source_row,
    source_submitted_at = excluded.source_submitted_at,
    payload_hash = excluded.payload_hash,
    raw_payload = excluded.raw_payload,
    cliente_nombre = excluded.cliente_nombre,
    whatsapp_raw = excluded.whatsapp_raw,
    whatsapp_e164 = excluded.whatsapp_e164,
    pais_telefono = excluded.pais_telefono,
    telefono_estado = excluded.telefono_estado,
    dni = excluded.dni,
    email = excluded.email,
    fecha_nacimiento = excluded.fecha_nacimiento,
    estado = case
      when public.cliente_form_ingestas.estado = 'SUCCEEDED'
       and public.cliente_form_ingestas.payload_hash = excluded.payload_hash
      then 'SUCCEEDED'
      else 'PROCESSING'
    end,
    attempts = case
      when public.cliente_form_ingestas.payload_hash = excluded.payload_hash
      then public.cliente_form_ingestas.attempts
      else public.cliente_form_ingestas.attempts + 1
    end,
    error_code = null,
    error_detail = null,
    updated_at = now()
  returning * into v_ingesta;

  if v_ingesta.estado = 'SUCCEEDED'
     and v_ingesta.payload_hash = v_payload_hash
     and v_ingesta.cliente_id is not null then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'estado', 'SUCCEEDED',
      'decision', v_ingesta.decision,
      'cliente_id', v_ingesta.cliente_id,
      'contacts_enqueued', true
    );
  end if;

  if v_tel_estado <> 'CANONICO'
     or v_e164 is null
     or v_e164 !~ '^\+[1-9][0-9]{7,14}$'
     or v_pais is null
     or v_pais !~ '^[A-Z]{2}$' then
    update public.cliente_form_ingestas
    set estado = 'PENDIENTE_REVISION',
        decision = 'NO_CANONICO',
        error_code = 'TELEFONO_NO_CANONICO',
        error_detail = 'Se conserva la respuesta, pero no se crea/actualiza cliente ni Google Contact.',
        processed_at = now(),
        updated_at = now()
    where ingesta_id = v_ingesta.ingesta_id;

    return jsonb_build_object(
      'ok', true,
      'estado', 'PENDIENTE_REVISION',
      'decision', 'NO_CANONICO',
      'cliente_id', null,
      'contacts_enqueued', false
    );
  end if;

  -- Serializa todas las ingestas que compiten por el mismo teléfono.
  perform pg_advisory_xact_lock(hashtextextended(v_e164, 0));

  select * into v_cliente
  from public.clientes
  where whatsapp_e164 = v_e164
  limit 1;

  if v_cliente.cliente_id is null then
    v_conflicto_id := null;

    if v_dni is not null then
      select cliente_id into v_conflicto_id
      from public.clientes
      where nullif(btrim(dni), '') is not null
        and lower(btrim(dni)) = lower(v_dni)
      limit 1;
    end if;

    if v_conflicto_id is null and v_email is not null then
      select cliente_id into v_conflicto_id
      from public.clientes
      where nullif(btrim(email), '') is not null
        and lower(btrim(email)) = v_email
      limit 1;
    end if;

    if v_conflicto_id is not null then
      update public.cliente_form_ingestas
      set estado = 'PENDIENTE_REVISION',
          decision = 'CONFLICTO_IDENTIDAD',
          error_code = 'IDENTIDAD_EXISTENTE_OTRO_WHATSAPP',
          error_detail = 'DNI o email ya pertenece a otra ficha; requiere revisión manual.',
          cliente_id = v_conflicto_id,
          processed_at = now(),
          updated_at = now()
      where ingesta_id = v_ingesta.ingesta_id;

      return jsonb_build_object(
        'ok', true,
        'estado', 'PENDIENTE_REVISION',
        'decision', 'CONFLICTO_IDENTIDAD',
        'cliente_id', v_conflicto_id,
        'contacts_enqueued', false
      );
    end if;

    v_cliente_id := 'CLI-FRM-' || upper(substr(md5(v_e164), 1, 12));

    insert into public.clientes (
      cliente_id, cliente, whatsapp, dni, email, fecha_nacimiento, origen,
      whatsapp_e164, pais_telefono, telefono_estado,
      telefono_normalizacion_origen, telefono_normalizado_en
    ) values (
      v_cliente_id,
      coalesce(v_nombre, 'Cliente ' || v_e164),
      coalesce(v_whatsapp_raw, v_e164),
      v_dni,
      v_email,
      p_fecha_nacimiento,
      'GOOGLE_FORM_N8N',
      v_e164,
      v_pais,
      'CANONICO',
      'APP_PAIS_DECLARADO',
      now()
    )
    returning * into v_cliente;

    update public.cliente_form_ingestas
    set cliente_id = v_cliente.cliente_id,
        estado = 'SUCCEEDED',
        decision = 'INSERTED',
        processed_at = now(),
        updated_at = now()
    where ingesta_id = v_ingesta.ingesta_id;
  else
    v_dni_actual := nullif(btrim(v_cliente.dni), '');
    v_email_actual := nullif(lower(btrim(v_cliente.email)), '');

    -- El teléfono coincide, pero una identidad fuerte distinta NO se ignora.
    if (v_dni is not null and v_dni_actual is not null and lower(v_dni) <> lower(v_dni_actual))
       or (v_email is not null and v_email_actual is not null and v_email <> v_email_actual) then
      update public.cliente_form_ingestas
      set cliente_id = v_cliente.cliente_id,
          estado = 'PENDIENTE_REVISION',
          decision = 'CONFLICTO_IDENTIDAD_MISMO_WHATSAPP',
          error_code = 'WHATSAPP_EXISTENTE_IDENTIDAD_DIFERENTE',
          error_detail = 'El E.164 ya existe, pero DNI/email entrante contradice la ficha maestra.',
          processed_at = now(),
          updated_at = now()
      where ingesta_id = v_ingesta.ingesta_id;

      return jsonb_build_object(
        'ok', true,
        'estado', 'PENDIENTE_REVISION',
        'decision', 'CONFLICTO_IDENTIDAD_MISMO_WHATSAPP',
        'cliente_id', v_cliente.cliente_id,
        'contacts_enqueued', false
      );
    end if;

    update public.clientes
    set cliente = case
          when (cliente is null or btrim(cliente) = '' or cliente ~ '^Cliente \+') and v_nombre is not null
          then v_nombre else cliente end,
        dni = coalesce(v_dni_actual, v_dni),
        email = coalesce(v_email_actual, v_email),
        fecha_nacimiento = coalesce(fecha_nacimiento, p_fecha_nacimiento),
        updated_at = now()
    where cliente_id = v_cliente.cliente_id
    returning * into v_cliente;

    update public.cliente_form_ingestas
    set cliente_id = v_cliente.cliente_id,
        estado = 'SUCCEEDED',
        decision = 'UPDATED',
        processed_at = now(),
        updated_at = now()
    where ingesta_id = v_ingesta.ingesta_id;
  end if;

  v_contact_hash := md5(concat_ws('|',
    coalesce(v_cliente.cliente, ''),
    coalesce(v_cliente.whatsapp_e164, ''),
    coalesce(v_cliente.email, ''),
    coalesce(v_cliente.fecha_nacimiento::text, '')
  ));

  insert into public.cliente_contact_sync_outbox (
    cliente_id, provider, estado, payload_hash, attempts, lease_until,
    next_retry_at, last_error, updated_at
  ) values (
    v_cliente.cliente_id, 'GOOGLE_CONTACTS', 'PENDING', v_contact_hash, 0,
    null, null, null, now()
  )
  on conflict (cliente_id, provider) do update set
    payload_hash = excluded.payload_hash,
    estado = case
      when public.cliente_contact_sync_outbox.payload_hash is distinct from excluded.payload_hash
        then 'PENDING'
      when public.cliente_contact_sync_outbox.estado in ('FAILED','DEAD','SKIPPED')
        then 'PENDING'
      else public.cliente_contact_sync_outbox.estado
    end,
    attempts = case
      when public.cliente_contact_sync_outbox.payload_hash is distinct from excluded.payload_hash
        then 0
      else public.cliente_contact_sync_outbox.attempts
    end,
    processing_token = case
      when public.cliente_contact_sync_outbox.payload_hash is distinct from excluded.payload_hash
        then null
      else public.cliente_contact_sync_outbox.processing_token
    end,
    lease_until = case
      when public.cliente_contact_sync_outbox.payload_hash is distinct from excluded.payload_hash
        then null
      else public.cliente_contact_sync_outbox.lease_until
    end,
    next_retry_at = case
      when public.cliente_contact_sync_outbox.payload_hash is distinct from excluded.payload_hash
        then null
      else public.cliente_contact_sync_outbox.next_retry_at
    end,
    last_error = case
      when public.cliente_contact_sync_outbox.payload_hash is distinct from excluded.payload_hash
        then null
      else public.cliente_contact_sync_outbox.last_error
    end,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'estado', 'SUCCEEDED',
    'decision', (select decision from public.cliente_form_ingestas where ingesta_id = v_ingesta.ingesta_id),
    'cliente_id', v_cliente.cliente_id,
    'contacts_enqueued', true
  );
exception
  when others then
    -- Este UPDATE forma parte de la misma transacción y será revertido si se
    -- relanza la excepción. n8n debe persistir el fallo mediante 035.
    raise;
end;
$$;

revoke all on function public.caja_ingestar_cliente_form_v1(
  text,text,integer,timestamptz,text,text,text,text,text,text,text,date,jsonb
) from public, anon, authenticated;
grant execute on function public.caja_ingestar_cliente_form_v1(
  text,text,integer,timestamptz,text,text,text,text,text,text,text,date,jsonb
) to service_role;

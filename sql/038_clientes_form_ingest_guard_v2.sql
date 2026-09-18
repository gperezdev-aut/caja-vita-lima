-- 038 · Guard de identidad para ingesta del Google Form.
-- Requiere 034 + 035 + 036 + 037.
--
-- v2 es el contrato operativo para n8n. Hace prevalidaciones que deben
-- ejecutarse en TODOS los reintentos antes de delegar al motor v1:
-- - una source_record_id ya ligada nunca puede cambiar a otro E.164;
-- - un E.164 existente con DNI/email contradictorios nunca se procesa como OK.
-- Después delega a v1, que conserva serialización por E.164 y outbox.

create or replace function public.caja_ingestar_cliente_form_v2(
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
  v_e164 text := nullif(btrim(p_whatsapp_e164), '');
  v_dni text := nullif(btrim(p_dni), '');
  v_email text := nullif(lower(btrim(p_email)), '');
  v_previa public.cliente_form_ingestas%rowtype;
  v_cliente public.clientes%rowtype;
begin
  if v_source_record_id is null then
    raise exception 'CAJA_FORM_SOURCE_ID_REQUIRED';
  end if;

  -- Serializa todos los reintentos de la misma fila fuente, incluso si la fila
  -- aún no existe en cliente_form_ingestas.
  perform pg_advisory_xact_lock(hashtextextended('FORM:' || v_source_record_id, 0));

  select * into v_previa
  from public.cliente_form_ingestas
  where source_system = 'GOOGLE_FORM'
    and source_record_id = v_source_record_id
  for update;

  if v_previa.ingesta_id is not null and v_previa.cliente_id is not null then
    select * into v_cliente
    from public.clientes
    where cliente_id = v_previa.cliente_id;

    if v_cliente.cliente_id is not null
       and v_e164 is distinct from v_cliente.whatsapp_e164 then
      update public.cliente_form_ingestas
      set source_sheet = coalesce(nullif(btrim(p_source_sheet), ''), source_sheet),
          source_row = coalesce(p_source_row, source_row),
          source_submitted_at = coalesce(p_source_submitted_at, source_submitted_at),
          payload_hash = md5(coalesce(p_raw_payload, '{}'::jsonb)::text),
          raw_payload = coalesce(p_raw_payload, '{}'::jsonb),
          cliente_nombre = nullif(btrim(p_cliente_nombre), ''),
          whatsapp_raw = nullif(btrim(p_whatsapp_raw), ''),
          whatsapp_e164 = v_e164,
          pais_telefono = nullif(upper(btrim(p_pais_telefono)), ''),
          telefono_estado = coalesce(nullif(upper(btrim(p_telefono_estado)), ''), 'PENDIENTE_REVISION'),
          dni = v_dni,
          email = v_email,
          fecha_nacimiento = p_fecha_nacimiento,
          estado = 'PENDIENTE_REVISION',
          decision = 'SOURCE_IDENTITY_CHANGED',
          error_code = 'SOURCE_RECORD_LINKED_OTHER_WHATSAPP',
          error_detail = 'La misma respuesta ya estaba ligada a otro cliente/E.164; requiere revisión manual.',
          attempts = attempts + 1,
          processed_at = now(),
          updated_at = now()
      where ingesta_id = v_previa.ingesta_id;

      return jsonb_build_object(
        'ok', true,
        'estado', 'PENDIENTE_REVISION',
        'decision', 'SOURCE_IDENTITY_CHANGED',
        'cliente_id', v_previa.cliente_id,
        'contacts_enqueued', false
      );
    end if;
  end if;

  -- Si el E.164 ya pertenece a un maestro, una contradicción fuerte de
  -- identidad no se ignora aunque la misma fila se reintente muchas veces.
  if v_e164 is not null then
    select * into v_cliente
    from public.clientes
    where whatsapp_e164 = v_e164
    limit 1;

    if v_cliente.cliente_id is not null
       and (
         (v_dni is not null and nullif(btrim(v_cliente.dni), '') is not null
          and lower(v_dni) <> lower(btrim(v_cliente.dni)))
         or
         (v_email is not null and nullif(btrim(v_cliente.email), '') is not null
          and v_email <> lower(btrim(v_cliente.email)))
       ) then
      insert into public.cliente_form_ingestas (
        source_system, source_record_id, source_sheet, source_row, source_submitted_at,
        payload_hash, raw_payload, cliente_nombre, whatsapp_raw, whatsapp_e164,
        pais_telefono, telefono_estado, dni, email, fecha_nacimiento,
        cliente_id, estado, decision, error_code, error_detail,
        attempts, processed_at, updated_at
      ) values (
        'GOOGLE_FORM', v_source_record_id, nullif(btrim(p_source_sheet), ''), p_source_row,
        p_source_submitted_at, md5(coalesce(p_raw_payload, '{}'::jsonb)::text),
        coalesce(p_raw_payload, '{}'::jsonb), nullif(btrim(p_cliente_nombre), ''),
        nullif(btrim(p_whatsapp_raw), ''), v_e164,
        nullif(upper(btrim(p_pais_telefono)), ''),
        coalesce(nullif(upper(btrim(p_telefono_estado)), ''), 'PENDIENTE_REVISION'),
        v_dni, v_email, p_fecha_nacimiento, v_cliente.cliente_id,
        'PENDIENTE_REVISION', 'CONFLICTO_IDENTIDAD_MISMO_WHATSAPP',
        'WHATSAPP_EXISTENTE_IDENTIDAD_DIFERENTE',
        'El E.164 ya existe, pero DNI/email entrante contradice la ficha maestra.',
        1, now(), now()
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
        cliente_id = excluded.cliente_id,
        estado = excluded.estado,
        decision = excluded.decision,
        error_code = excluded.error_code,
        error_detail = excluded.error_detail,
        attempts = public.cliente_form_ingestas.attempts + 1,
        processed_at = now(),
        updated_at = now();

      return jsonb_build_object(
        'ok', true,
        'estado', 'PENDIENTE_REVISION',
        'decision', 'CONFLICTO_IDENTIDAD_MISMO_WHATSAPP',
        'cliente_id', v_cliente.cliente_id,
        'contacts_enqueued', false
      );
    end if;
  end if;

  return public.caja_ingestar_cliente_form_v1(
    p_source_record_id,
    p_source_sheet,
    p_source_row,
    p_source_submitted_at,
    p_cliente_nombre,
    p_whatsapp_raw,
    p_whatsapp_e164,
    p_pais_telefono,
    p_telefono_estado,
    p_dni,
    p_email,
    p_fecha_nacimiento,
    p_raw_payload
  );
end;
$$;

revoke all on function public.caja_ingestar_cliente_form_v2(
  text,text,integer,timestamptz,text,text,text,text,text,text,text,date,jsonb
) from public, anon, authenticated;
grant execute on function public.caja_ingestar_cliente_form_v2(
  text,text,integer,timestamptz,text,text,text,text,text,text,text,date,jsonb
) to service_role;

-- v1 queda como implementación interna del guard v2. n8n no debe llamarla.
revoke execute on function public.caja_ingestar_cliente_form_v1(
  text,text,integer,timestamptz,text,text,text,text,text,text,text,date,jsonb
) from service_role;

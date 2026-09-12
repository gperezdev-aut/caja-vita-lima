-- Caja Vita Lima — transición atómica de reserva existente a atención.
-- Ejecutar manualmente después de 021. No lo ejecuta la aplicación.
--
-- Taxonomía mínima (sin reescribir históricos):
--   caja_movimientos: RESERVA_APP/Reservado -> ATENCION_APP/En atención|Atendido
--   citas_reservadas: PENDIENTE -> EN_ATENCION|ATENDIDA_APP
-- La ficha (pendiente|completa) y el comprobante se preservan sin cambios.
begin;

create table if not exists public.caja_atencion_reserva_requests (
  request_id uuid primary key,
  request_fingerprint text not null,
  movimiento_id text not null,
  reserva_id text not null,
  respuesta jsonb not null,
  creado_en timestamptz not null default now()
);

create index if not exists idx_atencion_reserva_request_movimiento
  on public.caja_atencion_reserva_requests (movimiento_id);

comment on table public.caja_atencion_reserva_requests is
  'Control server-only de idempotencia para transición y cobro de reservas existentes.';

revoke all on table public.caja_atencion_reserva_requests from public, anon, authenticated;
grant select, insert on table public.caja_atencion_reserva_requests to service_role;

create or replace function public.iniciar_o_cerrar_atencion_reservada_v1(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request_id uuid;
  v_fingerprint text;
  v_request public.caja_atencion_reserva_requests%rowtype;
  v_movimiento public.caja_movimientos%rowtype;
  v_reserva public.citas_reservadas%rowtype;
  v_movimiento_id text := btrim(coalesce(p_payload->>'movimiento_id', ''));
  v_reserva_id text := btrim(coalesce(p_payload->>'reserva_id', ''));
  v_responsable text := btrim(coalesce(p_payload->>'responsable', ''));
  v_observacion text := btrim(coalesce(p_payload->>'observacion', ''));
  v_metodo text := upper(btrim(coalesce(p_payload->>'metodo_pago', '')));
  v_numero_operacion text := btrim(coalesce(p_payload->>'numero_operacion', ''));
  v_terapistas jsonb := coalesce(p_payload->'terapistas', '[]'::jsonb);
  v_extras jsonb := coalesce(p_payload->'extras', '[]'::jsonb);
  v_pago numeric;
  v_total_ledger numeric(12,2);
  v_pendiente numeric(12,2);
  v_pago_id text;
  v_estado_movimiento text;
  v_estado_reserva text;
  v_instante_cobro timestamp without time zone := now() at time zone 'America/Lima';
  v_persona integer;
  v_terapista text;
  v_terapista_otro text;
  v_respuesta jsonb;
begin
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'PAYLOAD_INVALIDO';
  end if;

  begin
    v_request_id := (p_payload->>'request_id')::uuid;
    v_pago := coalesce((p_payload->>'pago_restante')::numeric, 0);
  exception when others then
    raise exception using errcode = '22023', message = 'REQUEST_O_PAGO_INVALIDO';
  end;

  if v_request_id is null then
    raise exception using errcode = '22023', message = 'REQUEST_ID_INVALIDO';
  end if;

  if v_movimiento_id = '' or v_reserva_id = '' or v_responsable = '' then
    raise exception using errcode = '22023', message = 'IDENTIFICADORES_Y_RESPONSABLE_REQUERIDOS';
  end if;
  if v_pago < 0 or v_pago <> round(v_pago, 2) then
    raise exception using errcode = '22023', message = 'PAGO_FINAL_INVALIDO';
  end if;
  if jsonb_typeof(v_terapistas) <> 'array' or jsonb_typeof(v_extras) <> 'array' then
    raise exception using errcode = '22023', message = 'TERAPISTAS_O_EXTRAS_INVALIDOS';
  end if;
  -- No existe catálogo/ledger de extras en el modelo actual. Fail closed:
  -- se preserva costo_movilidad/total_extras y no se aceptan nuevos importes.
  if jsonb_array_length(v_extras) <> 0 then
    raise exception using errcode = '0A000', message = 'EXTRAS_NO_SOPORTADOS_SIN_MODELO_AUDITABLE';
  end if;

  v_fingerprint := md5((p_payload - 'request_id')::text);
  -- Serializa incluso reintentos concurrentes del mismo request_id.
  perform pg_advisory_xact_lock(hashtextextended(v_request_id::text, 22022));

  select * into v_request
  from public.caja_atencion_reserva_requests
  where request_id = v_request_id
  for update;
  if found then
    if v_request.request_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = '23505', message = 'REQUEST_ID_PAYLOAD_CONFLICTO';
    end if;
    return v_request.respuesta || jsonb_build_object('reutilizado', true);
  end if;

  select * into v_movimiento
  from public.caja_movimientos
  where movimiento_id = v_movimiento_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'MOVIMIENTO_NO_EXISTE';
  end if;

  select * into v_reserva
  from public.citas_reservadas
  where reserva_id = v_reserva_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'RESERVA_NO_EXISTE';
  end if;

  if v_movimiento.source_id is distinct from v_reserva_id
     or v_reserva.source_id is distinct from v_movimiento_id then
    raise exception using errcode = '23514', message = 'RESERVA_MOVIMIENTO_NO_RELACIONADOS';
  end if;
  if v_movimiento.cliente_id is null
     or v_movimiento.cliente_id is distinct from v_reserva.cliente_id then
    raise exception using errcode = '23514', message = 'CLIENTE_RESERVA_MOVIMIENTO_NO_COINCIDE';
  end if;
  if v_movimiento.total_cobrar is distinct from v_reserva.monto_total then
    raise exception using errcode = '23514', message = 'TOTAL_RESERVA_MOVIMIENTO_NO_COINCIDE';
  end if;
  if coalesce(v_reserva.requiere_confirmacion, false)
     and v_reserva.confirmado_en is null then
    raise exception using errcode = '23514', message = 'RESERVA_PENDIENTE_DE_CONFIRMACION';
  end if;

  if v_movimiento.tipo_movimiento = 'ATENCION_APP'
     and v_movimiento.estado = 'Atendido' then
    raise exception using errcode = '23514', message = 'ATENCION_YA_COMPLETADA';
  end if;
  if not (
    (v_movimiento.tipo_movimiento = 'RESERVA_APP'
      and v_movimiento.estado = 'Reservado'
      and v_reserva.estado = 'PENDIENTE')
    or
    (v_movimiento.tipo_movimiento = 'ATENCION_APP'
      and v_movimiento.estado = 'En atención'
      and v_reserva.estado = 'EN_ATENCION')
  ) then
    raise exception using errcode = '23514', message = 'ESTADO_RESERVA_NO_TRANSICIONABLE';
  end if;

  perform 1 from public.caja_pagos
  where movimiento_id = v_movimiento_id
  for update;
  perform 1 from public.caja_atencion_detalle
  where movimiento_id = v_movimiento_id
  for update;

  select coalesce(sum(monto), 0) into v_total_ledger
  from public.caja_pagos where movimiento_id = v_movimiento_id;
  if v_total_ledger is distinct from coalesce(v_movimiento.total_pagado, 0) then
    raise exception using errcode = '23514', message = 'MOVIMIENTO_LEDGER_DESCUADRADO';
  end if;
  if v_movimiento.total_cobrar < 0 or v_total_ledger > v_movimiento.total_cobrar then
    raise exception using errcode = '23514', message = 'TOTAL_O_PAGOS_FUERA_DE_RANGO';
  end if;

  if jsonb_array_length(v_terapistas) <> v_movimiento.n_pax
     or exists (
       select 1 from jsonb_array_elements(v_terapistas) t
       where coalesce(t->>'persona', '') !~ '^[1-9][0-9]*$'
          or btrim(coalesce(t->>'terapista', '')) = ''
     )
     or (select count(distinct (t->>'persona')::int)
         from jsonb_array_elements(v_terapistas) t) <> v_movimiento.n_pax
     or exists (
       select 1 from jsonb_array_elements(v_terapistas) t
       where (t->>'persona')::int not between 1 and v_movimiento.n_pax
     ) then
    raise exception using errcode = '22023', message = 'TERAPISTA_POR_PERSONA_REQUERIDA';
  end if;

  if exists (
    select 1 from generate_series(1, v_movimiento.n_pax) persona
    where not exists (
      select 1 from public.caja_atencion_detalle d
      where d.movimiento_id = v_movimiento_id and d.persona_n = persona
    )
  ) or exists (
    select 1 from public.caja_atencion_detalle d
    where d.movimiento_id = v_movimiento_id
      and d.persona_n not between 1 and v_movimiento.n_pax
  ) then
    raise exception using errcode = '23514', message = 'DETALLE_ATENCION_INCONSISTENTE';
  end if;

  for v_persona, v_terapista, v_terapista_otro in
    select (t->>'persona')::int,
           btrim(t->>'terapista'),
           nullif(btrim(coalesce(t->>'terapista_otro', '')), '')
    from jsonb_array_elements(v_terapistas) t
    order by (t->>'persona')::int
  loop
    if not exists (
      select 1 from public.config_listas l
      where l.lista = 'TERAPISTAS' and l.activo is true
        and btrim(l.valor) = v_terapista
    ) then
      raise exception using errcode = '22023', message = 'TERAPISTA_NO_PERMITIDA';
    end if;
    if (v_terapista = 'Otro') is distinct from (v_terapista_otro is not null) then
      raise exception using errcode = '22023', message = 'TERAPISTA_OTRO_INVALIDO';
    end if;

    update public.caja_atencion_detalle
    set terapista = v_terapista,
        terapista_otro = v_terapista_otro,
        observacion = case when v_observacion = '' then observacion
          else concat_ws(E'\n', nullif(observacion, ''), v_observacion) end
    where movimiento_id = v_movimiento_id and persona_n = v_persona;
  end loop;

  v_pendiente := greatest(v_movimiento.total_cobrar - v_total_ledger, 0);
  if v_pago > v_pendiente then
    raise exception using errcode = '22023', message = 'PAGO_FINAL_SUPERA_PENDIENTE';
  end if;
  if v_pago > 0 then
    if v_metodo = '' then
      raise exception using errcode = '22023', message = 'METODO_PAGO_REQUERIDO';
    end if;
    if not exists (
      select 1 from public.config_listas l
      where l.lista = 'METODOS_PAGO' and l.activo is true
        and upper(btrim(l.valor)) = v_metodo
    ) then
      raise exception using errcode = '22023', message = 'METODO_PAGO_NO_PERMITIDO';
    end if;
    if v_metodo <> 'EFECTIVO' and v_numero_operacion = '' then
      raise exception using errcode = '22023', message = 'NUMERO_OPERACION_REQUERIDO';
    end if;

    v_pago_id := 'PAY-ATENCION-' || upper(gen_random_uuid()::text);
    insert into public.caja_pagos (
      pago_id, movimiento_id, fecha, hora, sede, tipo_pago, metodo,
      metodo_detalle, monto, concepto, numero_operacion
    ) values (
      v_pago_id, v_movimiento_id, v_instante_cobro::date,
      v_instante_cobro::time, v_movimiento.sede, 'SALDO_ATENCION_APP',
      v_metodo, null, v_pago, v_movimiento.servicio,
      nullif(v_numero_operacion, '')
    );
    v_total_ledger := v_total_ledger + v_pago;
  end if;

  v_pendiente := greatest(v_movimiento.total_cobrar - v_total_ledger, 0);
  v_estado_movimiento := case when v_pendiente = 0 then 'Atendido' else 'En atención' end;
  v_estado_reserva := case when v_pendiente = 0 then 'ATENDIDA_APP' else 'EN_ATENCION' end;

  update public.caja_movimientos
  set tipo_movimiento = 'ATENCION_APP',
      estado = v_estado_movimiento,
      total_pagado = v_total_ledger,
      pendiente = v_pendiente,
      responsable = v_responsable,
      observacion = case when v_observacion = '' then observacion
        else concat_ws(E'\n', nullif(observacion, ''), v_observacion) end,
      updated_at = now()
  where movimiento_id = v_movimiento_id;

  update public.citas_reservadas
  set estado = v_estado_reserva,
      saldo_pendiente = v_pendiente,
      observacion = case when v_observacion = '' then observacion
        else concat_ws(E'\n', nullif(observacion, ''), v_observacion) end,
      updated_at = now()
  where reserva_id = v_reserva_id;

  v_respuesta := jsonb_build_object(
    'ok', true,
    'reutilizado', false,
    'movimiento_id', v_movimiento_id,
    'reserva_id', v_reserva_id,
    'cliente_id', v_movimiento.cliente_id,
    'pago_id', v_pago_id,
    'pago_registrado', v_pago,
    'total_cobrar', v_movimiento.total_cobrar,
    'total_pagado', v_total_ledger,
    'pendiente', v_pendiente,
    'estado_movimiento', v_estado_movimiento,
    'estado_reserva', v_estado_reserva,
    'completada', v_pendiente = 0
  );

  insert into public.caja_atencion_reserva_requests (
    request_id, request_fingerprint, movimiento_id, reserva_id, respuesta
  ) values (
    v_request_id, v_fingerprint, v_movimiento_id, v_reserva_id, v_respuesta
  );

  return v_respuesta;
end;
$$;

revoke all on function public.iniciar_o_cerrar_atencion_reservada_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.iniciar_o_cerrar_atencion_reservada_v1(jsonb)
  to service_role;

commit;

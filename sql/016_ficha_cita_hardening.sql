-- ============================================================
-- Caja Vita Lima — Supabase SQL v16
-- Hardening integral de la preparación y finalización de fichas.
-- Ejecutar después de 015. No se ejecuta desde la aplicación.
-- ============================================================

alter table public.citas_reservadas
  add column if not exists request_id uuid,
  add column if not exists request_fingerprint text;

create unique index if not exists uq_citas_request_id
  on public.citas_reservadas (request_id)
  where request_id is not null;

create table if not exists public.solicitudes_comprobante (
  solicitud_id text primary key,
  reserva_id text not null unique,
  cliente_id text not null,
  tipo_comprobante text not null,
  tipo_documento text not null,
  numero_documento text not null,
  razon_social text,
  estado text not null default 'PENDIENTE',
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists idx_solicitudes_comprobante_cliente
  on public.solicitudes_comprobante (cliente_id);
create index if not exists idx_solicitudes_comprobante_estado
  on public.solicitudes_comprobante (estado);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_solicitud_tipo_comprobante') then
    alter table public.solicitudes_comprobante add constraint chk_solicitud_tipo_comprobante
      check (tipo_comprobante in ('BOLETA', 'FACTURA'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_solicitud_tipo_documento') then
    alter table public.solicitudes_comprobante add constraint chk_solicitud_tipo_documento
      check (tipo_documento in ('DNI', 'RUC'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_solicitud_estado') then
    alter table public.solicitudes_comprobante add constraint chk_solicitud_estado
      check (estado in ('PENDIENTE', 'EMITIDO', 'ANULADO'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_solicitud_documento_comprobante') then
    alter table public.solicitudes_comprobante add constraint chk_solicitud_documento_comprobante check (
      (tipo_documento = 'DNI' and tipo_comprobante = 'BOLETA' and numero_documento ~ '^\d{8}$' and razon_social is null)
      or
      (tipo_documento = 'RUC' and tipo_comprobante = 'FACTURA' and numero_documento ~ '^\d{11}$' and nullif(btrim(razon_social), '') is not null)
    );
  end if;
end;
$$;

-- Sustituye la versión de 015 conservando la firma. La RPC recalcula todo
-- importe desde el catálogo y aplica idempotencia antes de escribir.
create or replace function public.preparar_ficha_cita(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_fingerprint text;
  v_existente public.citas_reservadas%rowtype;
  v_canal text := lower(btrim(coalesce(p_payload->>'canal', '')));
  v_personas int := coalesce((p_payload->>'personas')::int, 0);
  v_fecha date := (p_payload->>'fecha')::date;
  v_hora time := (p_payload->>'hora')::time;
  v_tipo_atencion text := lower(btrim(coalesce(p_payload->>'tipo_atencion', 'sede')));
  v_sede text := btrim(coalesce(p_payload->>'sede_operativa', p_payload->>'sede', ''));
  v_distrito text := btrim(coalesce(p_payload->>'domicilio_distrito', ''));
  v_direccion text := btrim(coalesce(p_payload->>'domicilio_direccion', ''));
  v_referencia text := btrim(coalesce(p_payload->>'domicilio_referencia', ''));
  v_cliente text := btrim(coalesce(p_payload->>'cliente', ''));
  v_whatsapp text := btrim(coalesce(p_payload->>'whatsapp_e164', ''));
  v_pais text := upper(btrim(coalesce(p_payload->>'pais_telefono', '')));
  v_entrada_servicios jsonb := coalesce(p_payload->'servicios', '[]'::jsonb);
  v_servicios jsonb;
  v_catalogo_valido boolean;
  v_todos_dom boolean;
  v_alguno_dom boolean;
  v_subtotal numeric(12,2);
  v_movilidad numeric(12,2) := 0;
  v_total numeric(12,2);
  v_pagado numeric(12,2) := coalesce((p_payload->>'monto_pagado')::numeric, 0);
  v_adelanto_requerido numeric(12,2);
  v_requiere_confirmacion boolean;
  v_duracion int;
  v_servicio_resumen text;
  v_apertura time;
  v_cierre time;
  v_cliente_id text;
  v_token text := btrim(coalesce(p_payload->>'token', ''));
  v_token_expira timestamptz := (p_payload->>'token_expira')::timestamptz;
  v_movimiento_id text := btrim(coalesce(p_payload->>'movimiento_id', ''));
  v_reserva_id text := btrim(coalesce(p_payload->>'reserva_id', ''));
  v_pago_id text := btrim(coalesce(p_payload->>'pago_id', ''));
  v_item jsonb;
  v_n int := 0;
begin
  begin
    v_request_id := (p_payload->>'request_id')::uuid;
  exception when others then
    raise exception using errcode = '22023', message = 'REQUEST_ID_INVALIDO';
  end;

  v_fingerprint := md5((p_payload
    - 'request_id' - 'cliente_id' - 'movimiento_id' - 'reserva_id'
    - 'pago_id' - 'token')::text);

  select * into v_existente from public.citas_reservadas
  where request_id = v_request_id for update;
  if found then
    if v_existente.request_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = '23505', message = 'REQUEST_ID_PAYLOAD_CONFLICTO';
    end if;
    return jsonb_build_object(
      'ok', true, 'reutilizado', true, 'reserva_id', v_existente.reserva_id,
      'movimiento_id', v_existente.source_id, 'token', v_existente.token_ficha,
      'requiere_confirmacion', v_existente.requiere_confirmacion
    );
  end if;

  if v_canal <> 'directo'
     or coalesce((p_payload->>'es_gift_card')::boolean, false)
     or btrim(coalesce(p_payload->>'cupon_promocional', '')) <> '' then
    raise exception using errcode = '22023', message = 'PREPARAR_CITA_MVP_SOLO_DIRECTO';
  end if;
  if v_personas not in (1, 2) or v_cliente = '' then
    raise exception using errcode = '22023', message = 'DATOS_PREPARACION_INVALIDOS';
  end if;
  if v_fecha < (now() at time zone 'America/Lima')::date then
    raise exception using errcode = '22023', message = 'FECHA_CITA_PASADA';
  end if;
  if v_whatsapp !~ '^\+[1-9][0-9]{7,14}$' or v_pais !~ '^[A-Z]{2}$' then
    raise exception using errcode = '22023', message = 'TELEFONO_E164_INVALIDO';
  end if;
  if jsonb_typeof(v_entrada_servicios) <> 'array'
     or jsonb_array_length(v_entrada_servicios) <> v_personas then
    raise exception using errcode = '22023', message = 'UN_SERVICIO_POR_PERSONA';
  end if;

  with solicitados as (
    select ord, btrim(x->>'codigo') as codigo
    from jsonb_array_elements(v_entrada_servicios) with ordinality items(x, ord)
  ), catalogo as (
    select s.ord, s.codigo,
      count(c."CodeId") as coincidencias,
      min(nullif(btrim(c.option_name::text), '')) as nombre,
      min(nullif(regexp_replace(c.duration_min::text, '[^0-9]', '', 'g'), '')::int) as duracion,
      min(nullif(replace(regexp_replace(c.price_pen::text, '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric) as precio
    from solicitados s
    left join public.stg_services_catalog_v5 c
      on btrim(c."CodeId"::text) = s.codigo
     and lower(coalesce(c.active::text, '')) in ('true', '1', 'yes', 'si', 'sí')
    group by s.ord, s.codigo
  )
  select
    bool_and(coincidencias = 1 and nombre is not null and precio > 0 and duracion > 0),
    bool_and(codigo in ('DOM-1H', 'DOM-2H')),
    bool_or(codigo in ('DOM-1H', 'DOM-2H')),
    jsonb_agg(jsonb_build_object('codigo', codigo, 'nombre', nombre, 'duracion_min', duracion, 'precio', precio) order by ord),
    round(sum(precio), 2), max(duracion), string_agg(nombre, ' + ' order by ord)
  into v_catalogo_valido, v_todos_dom, v_alguno_dom, v_servicios, v_subtotal, v_duracion, v_servicio_resumen
  from catalogo;

  if not coalesce(v_catalogo_valido, false) then
    raise exception using errcode = '22023', message = 'CATALOGO_SERVICIO_INVALIDO_O_DUPLICADO';
  end if;
  if coalesce(v_alguno_dom, false) and not coalesce(v_todos_dom, false) then
    raise exception using errcode = '22023', message = 'SERVICIOS_PRESENCIAL_DOMICILIO_MEZCLADOS';
  end if;
  if (v_todos_dom and v_tipo_atencion <> 'domicilio')
     or (not v_todos_dom and v_tipo_atencion <> 'sede') then
    raise exception using errcode = '22023', message = 'TIPO_ATENCION_NO_COINCIDE';
  end if;

  select s.hora_apertura, s.hora_cierre into v_apertura, v_cierre
  from public.sedes s where s.nombre = v_sede and s.activo is true;
  if not found or v_apertura is null or v_cierre is null then
    raise exception using errcode = '22023', message = 'SEDE_OPERATIVA_INVALIDA';
  end if;
  if v_hora < v_apertura or v_hora + make_interval(mins => v_duracion) > v_cierre then
    raise exception using errcode = '22023', message = 'HORARIO_FUERA_DE_SEDE';
  end if;

  if v_tipo_atencion = 'domicilio' then
    if v_distrito = '' or v_direccion = '' then
      raise exception using errcode = '22023', message = 'DOMICILIO_INCOMPLETO';
    end if;
    v_movilidad := 15;
    v_requiere_confirmacion := true;
  else
    v_distrito := ''; v_direccion := ''; v_referencia := '';
    v_requiere_confirmacion := false;
  end if;

  v_total := round(v_subtotal + v_movilidad, 2);
  v_adelanto_requerido := case
    when v_tipo_atencion = 'domicilio' or v_personas = 2 then round(v_total * 0.50, 2)
    else least(10, v_total)
  end;
  if v_pagado < v_adelanto_requerido then
    raise exception using errcode = '22023', message = 'PAGO_INSUFICIENTE';
  end if;
  if v_pagado > 0 and btrim(coalesce(p_payload->>'metodo_pago', '')) = '' then
    raise exception using errcode = '22023', message = 'METODO_PAGO_REQUERIDO';
  end if;
  if v_pagado > 0 and upper(btrim(coalesce(p_payload->>'metodo_pago', ''))) <> 'EFECTIVO'
     and btrim(coalesce(p_payload->>'numero_operacion', '')) = '' then
    raise exception using errcode = '22023', message = 'NUMERO_OPERACION_REQUERIDO';
  end if;
  if v_token !~ '^[A-Za-z0-9_-]{43}$' or v_token_expira <= (v_fecha + v_hora) at time zone 'America/Lima' then
    raise exception using errcode = '22023', message = 'TOKEN_O_EXPIRACION_INVALIDOS';
  end if;
  if v_movimiento_id = '' or v_reserva_id = '' or v_pago_id = '' then
    raise exception using errcode = '22023', message = 'IDENTIFICADORES_OPERACION_REQUERIDOS';
  end if;

  select c.cliente_id into v_cliente_id from public.clientes c where c.whatsapp_e164 = v_whatsapp limit 1;
  if v_cliente_id is null then
    v_cliente_id := btrim(coalesce(p_payload->>'cliente_id', ''));
    if v_cliente_id = '' then raise exception using errcode = '22023', message = 'CLIENTE_ID_REQUERIDO'; end if;
    insert into public.clientes (cliente_id, cliente, whatsapp, whatsapp_e164, pais_telefono, ultima_sede, ultimo_servicio, origen, updated_at)
    values (v_cliente_id, v_cliente, v_whatsapp, v_whatsapp, v_pais, v_sede, v_servicio_resumen, 'APP_CAJA_FICHA', now());
  else
    update public.clientes set cliente = v_cliente, whatsapp = v_whatsapp, pais_telefono = v_pais,
      ultima_sede = v_sede, ultimo_servicio = v_servicio_resumen, updated_at = now()
    where cliente_id = v_cliente_id;
  end if;

  insert into public.caja_movimientos (
    movimiento_id, fecha, hora, sede, tipo_movimiento, estado, cliente_id, cliente, whatsapp, n_pax,
    servicio, duracion, monto_servicio, adelanto_prev, metodo_adelanto_prev, total_cobrar, total_pagado,
    total_extras, pendiente, responsable, source_type, source_id, observacion, estado_boleta, numero_boleta
  ) values (
    v_movimiento_id, v_fecha, v_hora, v_sede, 'RESERVA_APP',
    case when v_requiere_confirmacion then 'Pendiente de confirmación' else 'Reservado' end,
    v_cliente_id, v_cliente, v_whatsapp, v_personas, v_servicio_resumen, v_duracion || ' min',
    v_subtotal, v_pagado, nullif(btrim(p_payload->>'metodo_pago'), ''), v_total, v_pagado,
    v_movilidad, greatest(v_total - v_pagado, 0), nullif(btrim(p_payload->>'responsable'), ''),
    'APP_CAJA_FICHA', v_reserva_id, nullif(btrim(p_payload->>'observacion'), ''), 'No aplica', null
  );

  insert into public.citas_reservadas (
    reserva_id, fecha_cita, hora_cita, sede, cliente_id, cliente, whatsapp, n_pax, personas, servicio,
    duracion, duracion_min, monto_total, adelanto, metodo_adelanto, saldo_pendiente, estado, source,
    source_id, estado_ficha, canal, requiere_confirmacion, confirmado_en, idioma, token_ficha, token_expira,
    es_gift_card, cupon_promocional, servicios_json, observacion, tipo_atencion, sede_operativa,
    domicilio_distrito, domicilio_direccion, domicilio_referencia, costo_movilidad, request_id, request_fingerprint
  ) values (
    v_reserva_id, v_fecha, v_hora, v_sede, v_cliente_id, v_cliente, v_whatsapp, v_personas, v_personas,
    v_servicio_resumen, v_duracion || ' min', v_duracion, v_total, v_pagado,
    nullif(btrim(p_payload->>'metodo_pago'), ''), greatest(v_total - v_pagado, 0), 'PENDIENTE',
    'APP_CAJA_FICHA', v_movimiento_id, 'pendiente', 'directo', v_requiere_confirmacion, null,
    coalesce(nullif(btrim(p_payload->>'idioma'), ''), 'es'), v_token, v_token_expira, false, null,
    v_servicios, nullif(btrim(p_payload->>'observacion'), ''), v_tipo_atencion, v_sede,
    nullif(v_distrito, ''), nullif(v_direccion, ''), nullif(v_referencia, ''), v_movilidad,
    v_request_id, v_fingerprint
  );

  insert into public.caja_pagos (pago_id, movimiento_id, fecha, hora, sede, tipo_pago, metodo, metodo_detalle, monto, concepto, numero_operacion)
  values (v_pago_id, v_movimiento_id, v_fecha, v_hora, v_sede, 'ADELANTO_APP',
    btrim(p_payload->>'metodo_pago'), null, v_pagado, v_servicio_resumen,
    nullif(btrim(p_payload->>'numero_operacion'), ''));

  for v_item in select value from jsonb_array_elements(v_servicios) loop
    v_n := v_n + 1;
    insert into public.caja_atencion_detalle (detalle_id, movimiento_id, fecha, sede, persona_n, terapista, servicio, duracion, monto_asignado, observacion)
    values (v_reserva_id || '-P' || v_n, v_movimiento_id, v_fecha, v_sede, v_n, 'Por asignar',
      btrim(v_item->>'nombre'), (v_item->>'duracion_min') || ' min', (v_item->>'precio')::numeric,
      nullif(btrim(p_payload->>'observacion'), ''));
  end loop;

  return jsonb_build_object('ok', true, 'reutilizado', false, 'reserva_id', v_reserva_id,
    'movimiento_id', v_movimiento_id, 'token', v_token,
    'adelanto_requerido', v_adelanto_requerido, 'requiere_confirmacion', v_requiere_confirmacion);
exception
  when unique_violation then
    if exists (select 1 from public.citas_reservadas where request_id = v_request_id) then
      select * into v_existente from public.citas_reservadas where request_id = v_request_id;
      if v_existente.request_fingerprint = v_fingerprint then
        return jsonb_build_object('ok', true, 'reutilizado', true, 'reserva_id', v_existente.reserva_id,
          'movimiento_id', v_existente.source_id, 'token', v_existente.token_ficha,
          'requiere_confirmacion', v_existente.requiere_confirmacion);
      end if;
      raise exception using errcode = '23505', message = 'REQUEST_ID_PAYLOAD_CONFLICTO';
    end if;
    raise;
end;
$$;

revoke all on function public.preparar_ficha_cita(jsonb) from public, anon, authenticated;
grant execute on function public.preparar_ficha_cita(jsonb) to service_role;

-- Sustituye completar_ficha_cita de 014 conservando la firma y atomicidad.
create or replace function public.completar_ficha_cita(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cita public.citas_reservadas%rowtype;
  v_cliente public.clientes%rowtype;
  v_cliente_id text;
  v_propietario_whatsapp text;
  v_whatsapp text := btrim(coalesce(p_payload->>'whatsapp_e164', ''));
  v_nombre text := btrim(coalesce(p_payload->>'nombre', ''));
  v_ahora timestamptz := now();
  v_salud jsonb := coalesce(p_payload->'salud', '{}'::jsonb);
  v_codigo_cupon text := btrim(coalesce(p_payload->>'codigo_cupon', ''));
  v_solicita boolean := coalesce((p_payload->>'solicita_comprobante')::boolean, false);
  v_tipo_comprobante text := upper(btrim(coalesce(p_payload->>'tipo_comprobante', '')));
  v_tipo_documento text := upper(btrim(coalesce(p_payload->>'tipo_documento', '')));
  v_numero_documento text := btrim(coalesce(p_payload->>'numero_documento', ''));
  v_razon_social text := btrim(coalesce(p_payload->>'razon_social', ''));
  v_constraint text;
begin
  select * into v_cita from public.citas_reservadas where token_ficha = p_token for update;
  if not found then raise exception using errcode = 'P0002', message = 'TOKEN_NO_EXISTE'; end if;
  if v_cita.token_expira is not null and v_cita.token_expira <= v_ahora then
    raise exception using errcode = '22023', message = 'TOKEN_VENCIDO';
  end if;
  if v_cita.estado_ficha = 'completa' then
    raise exception using errcode = '22023', message = 'FICHA_YA_COMPLETA';
  end if;
  if v_nombre = '' or v_whatsapp !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception using errcode = '22023', message = 'DATOS_CLIENTE_INVALIDOS';
  end if;

  select cliente_id into v_propietario_whatsapp from public.clientes
  where whatsapp_e164 = v_whatsapp limit 1;
  if v_propietario_whatsapp is not null and v_cita.cliente_id is not null
     and v_propietario_whatsapp <> v_cita.cliente_id then
    raise exception using errcode = 'P0001', message = 'TELEFONO_ASOCIADO_OTRO_CLIENTE';
  end if;
  v_cliente_id := coalesce(v_cita.cliente_id, v_propietario_whatsapp, nullif(btrim(p_payload->>'cliente_id'), ''));
  if v_cliente_id is null then raise exception using errcode = '22023', message = 'CLIENTE_ID_REQUERIDO'; end if;
  select * into v_cliente from public.clientes where cliente_id = v_cliente_id;

  if v_solicita then
    if (v_tipo_documento = 'DNI' and (v_tipo_comprobante <> 'BOLETA' or v_numero_documento !~ '^\d{8}$' or v_razon_social <> ''))
       or (v_tipo_documento = 'RUC' and (v_tipo_comprobante <> 'FACTURA' or v_numero_documento !~ '^\d{11}$' or v_razon_social = ''))
       or v_tipo_documento not in ('DNI', 'RUC') then
      raise exception using errcode = '22023', message = 'COMPROBANTE_INVALIDO';
    end if;
  end if;
  if v_cita.canal in ('cuponidad', 'bee') and v_codigo_cupon = '' then
    raise exception using errcode = '22023', message = 'FALTA_CODIGO_CONVENIO';
  end if;

  insert into public.clientes (
    cliente_id, cliente, email, dni, whatsapp, whatsapp_e164, pais_telefono, idioma,
    cumple_dia, cumple_mes, consent_datos_en, consent_promos_en, updated_at
  ) values (
    v_cliente_id, v_nombre, nullif(btrim(p_payload->>'correo'), ''),
    case when v_solicita and v_tipo_documento = 'DNI' then v_numero_documento else null end,
    v_whatsapp, v_whatsapp, upper(btrim(p_payload->>'pais_telefono')),
    coalesce(nullif(btrim(p_payload->>'idioma'), ''), coalesce(v_cliente.idioma, 'es')),
    nullif(p_payload->>'cumple_dia', '')::smallint, nullif(p_payload->>'cumple_mes', '')::smallint,
    v_ahora, case when coalesce((p_payload->>'consent_promos')::boolean, false) then v_ahora else null end, v_ahora
  ) on conflict (cliente_id) do update set
    cliente = excluded.cliente,
    email = coalesce(excluded.email, clientes.email),
    dni = coalesce(excluded.dni, clientes.dni),
    whatsapp = excluded.whatsapp,
    whatsapp_e164 = excluded.whatsapp_e164,
    pais_telefono = excluded.pais_telefono,
    idioma = excluded.idioma,
    cumple_dia = coalesce(excluded.cumple_dia, clientes.cumple_dia),
    cumple_mes = coalesce(excluded.cumple_mes, clientes.cumple_mes),
    consent_datos_en = excluded.consent_datos_en,
    consent_promos_en = case when coalesce((p_payload->>'consent_promos')::boolean, false)
      then excluded.consent_promos_en else clientes.consent_promos_en end,
    updated_at = excluded.updated_at;

  if coalesce((p_payload->>'guardar_salud')::boolean, false) then
    insert into public.fichas_salud (ficha_id, reserva_id, cliente_id, embarazo, presion, cirugia_reciente, alergias, zonas_evitar, notas, consent_salud_en)
    values (btrim(p_payload->>'ficha_id'), v_cita.reserva_id, v_cliente_id,
      coalesce((v_salud->>'embarazo')::boolean, false), coalesce((v_salud->>'presion')::boolean, false),
      coalesce((v_salud->>'cirugia_reciente')::boolean, false), nullif(btrim(v_salud->>'alergias'), ''),
      nullif(btrim(v_salud->>'zonas_evitar'), ''), nullif(btrim(v_salud->>'notas'), ''), v_ahora)
    on conflict (reserva_id) do update set cliente_id = excluded.cliente_id, embarazo = excluded.embarazo,
      presion = excluded.presion, cirugia_reciente = excluded.cirugia_reciente, alergias = excluded.alergias,
      zonas_evitar = excluded.zonas_evitar, notas = excluded.notas, consent_salud_en = excluded.consent_salud_en;
  end if;

  if v_codigo_cupon <> '' then
    insert into public.cupones_convenios (registro_id, fecha, sede, plataforma, codigo_cupon, cliente, whatsapp, n_pax, servicio, estado, reserva_id)
    values (btrim(p_payload->>'cupon_id'), v_cita.fecha_cita, v_cita.sede,
      case v_cita.canal when 'cuponidad' then 'Cuponidad' when 'bee' then 'Bee Beneficios' else v_cita.canal end,
      v_codigo_cupon, v_nombre, v_whatsapp, coalesce(v_cita.personas, v_cita.n_pax, 1), v_cita.servicio, 'declarado', v_cita.reserva_id);
  end if;

  if v_solicita then
    insert into public.solicitudes_comprobante (solicitud_id, reserva_id, cliente_id, tipo_comprobante, tipo_documento, numero_documento, razon_social, estado)
    values ('COMP-' || v_cita.reserva_id, v_cita.reserva_id, v_cliente_id, v_tipo_comprobante,
      v_tipo_documento, v_numero_documento, nullif(v_razon_social, ''), 'PENDIENTE')
    on conflict (reserva_id) do update set cliente_id = excluded.cliente_id,
      tipo_comprobante = excluded.tipo_comprobante, tipo_documento = excluded.tipo_documento,
      numero_documento = excluded.numero_documento, razon_social = excluded.razon_social,
      estado = 'PENDIENTE', actualizado_en = v_ahora;
  end if;

  update public.citas_reservadas set cliente_id = v_cliente_id, cliente = v_nombre,
    dni = case when v_solicita and v_tipo_documento = 'DNI' then v_numero_documento else dni end,
    whatsapp = v_whatsapp, estado_ficha = 'completa', updated_at = v_ahora
  where reserva_id = v_cita.reserva_id;

  update public.caja_movimientos set cliente_id = v_cliente_id, cliente = v_nombre, whatsapp = v_whatsapp,
    dni = case when v_solicita and v_tipo_documento = 'DNI' then v_numero_documento else dni end,
    estado_boleta = case when v_solicita then 'Pendiente' else 'No aplica' end,
    numero_boleta = null, updated_at = v_ahora
  where movimiento_id = v_cita.source_id or source_id = v_cita.reserva_id;

  return jsonb_build_object('ok', true, 'cliente_id', v_cliente_id);
exception
  when unique_violation then
    get stacked diagnostics v_constraint = CONSTRAINT_NAME;
    if v_constraint = 'uq_clientes_whatsapp_e164' then
      raise exception using errcode = 'P0001', message = 'TELEFONO_ASOCIADO_OTRO_CLIENTE';
    end if;
    if v_constraint = 'uq_cupones_plataforma_codigo' then
      raise exception using errcode = '23505', message = 'CUPON_YA_USADO';
    end if;
    raise exception using errcode = '23505', message = 'CONFLICTO_INTEGRIDAD', detail = coalesce(v_constraint, 'sin_constraint');
end;
$$;

revoke all on function public.completar_ficha_cita(text, jsonb) from public, anon, authenticated;
grant execute on function public.completar_ficha_cita(text, jsonb) to service_role;

-- Caja Vita Lima — RPC transaccional de conciliación final de atención V2
-- Migración 035. Ejecutar manualmente después de 034.
--
-- Contrato incremental: cada request_id agrega únicamente conceptos nuevos.
-- Los reintentos con el mismo request_id son idempotentes; un payload distinto
-- para el mismo request_id se rechaza.

begin;

create or replace function public.conciliar_atencion_v2(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request_id uuid;
  v_fingerprint text;
  v_saved public.caja_conciliacion_atencion_requests%rowtype;
  v_mov public.caja_movimientos%rowtype;
  v_res public.citas_reservadas%rowtype;
  v_movimiento_id text := btrim(coalesce(p_payload->>'movimiento_id', ''));
  v_reserva_id text := nullif(btrim(coalesce(p_payload->>'reserva_id', '')), '');
  v_responsable text := btrim(coalesce(p_payload->>'responsable', ''));
  v_observacion text := btrim(coalesce(p_payload->>'observacion', ''));
  v_extras jsonb := coalesce(p_payload->'extras', '[]'::jsonb);
  v_ajustes jsonb := coalesce(p_payload->'ajustes', '[]'::jsonb);
  v_coberturas jsonb := coalesce(p_payload->'coberturas', '[]'::jsonb);
  v_pagos jsonb := coalesce(p_payload->'pagos', '[]'::jsonb);
  v_terapistas jsonb := coalesce(p_payload->'terapistas', '[]'::jsonb);
  v_propina jsonb := p_payload->'propina';
  v_item jsonb;
  v_dist jsonb;
  v_tipo text;
  v_concepto text;
  v_motivo text;
  v_metodo text;
  v_operacion text;
  v_referencia text;
  v_cantidad numeric(12,2);
  v_unitario numeric(12,2);
  v_monto numeric(12,2);
  v_duracion integer;
  v_persona integer;
  v_extra_nuevo numeric(12,2) := 0;
  v_ajuste_nuevo numeric(12,2) := 0;
  v_cobertura_nueva numeric(12,2) := 0;
  v_cobertura_previa numeric(12,2) := 0;
  v_ledger_previo numeric(12,2) := 0;
  v_ledger_final numeric(12,2) := 0;
  v_total_cobrar numeric(12,2);
  v_pendiente_antes_pagos numeric(12,2);
  v_pendiente numeric(12,2);
  v_pago_nuevo numeric(12,2) := 0;
  v_pago_id text;
  v_fecha_hora timestamp without time zone := now() at time zone 'America/Lima';
  v_propina_id uuid;
  v_propina_monto numeric(12,2);
  v_propina_distribuida numeric(12,2);
  v_terapista_id uuid;
  v_terapista_nombre text;
  v_estado_movimiento text;
  v_estado_reserva text;
  v_hold public.gift_card_reservas%rowtype;
  v_gift public.gift_cards%rowtype;
  v_uso_id uuid;
  v_gift_usado numeric(12,2);
  v_gift_saldo numeric(12,2);
  v_gift_estado text;
  v_convenio public.cupones_convenios%rowtype;
  v_respuesta jsonb;
begin
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'PAYLOAD_INVALIDO';
  end if;

  begin
    v_request_id := (p_payload->>'request_id')::uuid;
  exception when others then
    raise exception using errcode = '22023', message = 'REQUEST_ID_INVALIDO';
  end;

  if v_request_id is null or v_movimiento_id = '' or v_responsable = '' then
    raise exception using errcode = '22023', message = 'IDENTIFICADORES_Y_RESPONSABLE_REQUERIDOS';
  end if;

  if jsonb_typeof(v_extras) <> 'array'
     or jsonb_typeof(v_ajustes) <> 'array'
     or jsonb_typeof(v_coberturas) <> 'array'
     or jsonb_typeof(v_pagos) <> 'array'
     or jsonb_typeof(v_terapistas) <> 'array' then
    raise exception using errcode = '22023', message = 'COLECCIONES_V2_INVALIDAS';
  end if;
  if v_propina is not null and jsonb_typeof(v_propina) <> 'object' then
    raise exception using errcode = '22023', message = 'PROPINA_INVALIDA';
  end if;

  v_fingerprint := encode(extensions.digest((p_payload - 'request_id')::text, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_request_id::text, 35001));

  select * into v_saved
  from public.caja_conciliacion_atencion_requests
  where request_id = v_request_id
  for update;
  if found then
    if v_saved.request_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = '23505', message = 'REQUEST_ID_PAYLOAD_CONFLICTO';
    end if;
    return v_saved.respuesta || jsonb_build_object('reutilizado', true);
  end if;

  select * into v_mov
  from public.caja_movimientos
  where movimiento_id = v_movimiento_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'MOVIMIENTO_NO_EXISTE';
  end if;

  if v_reserva_id is not null then
    select * into v_res
    from public.citas_reservadas
    where reserva_id = v_reserva_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'RESERVA_NO_EXISTE';
    end if;
    if v_mov.source_id is distinct from v_reserva_id
       or v_res.source_id is distinct from v_movimiento_id
       or v_mov.cliente_id is distinct from v_res.cliente_id then
      raise exception using errcode = '23514', message = 'RESERVA_MOVIMIENTO_NO_RELACIONADOS';
    end if;
  end if;

  if v_mov.tipo_movimiento not in ('RESERVA_APP','ATENCION_APP') then
    raise exception using errcode = '23514', message = 'MOVIMIENTO_NO_CONCILIABLE';
  end if;
  if v_mov.estado = 'Atendido' then
    raise exception using errcode = '23514', message = 'ATENCION_YA_COMPLETADA';
  end if;

  perform 1 from public.caja_pagos where movimiento_id = v_movimiento_id for update;
  perform 1 from public.caja_atencion_extras where movimiento_id = v_movimiento_id for update;
  perform 1 from public.caja_atencion_ajustes where movimiento_id = v_movimiento_id for update;
  perform 1 from public.caja_atencion_coberturas where movimiento_id = v_movimiento_id for update;
  perform 1 from public.caja_atencion_detalle where movimiento_id = v_movimiento_id for update;

  select coalesce(sum(monto), 0)::numeric(12,2)
    into v_ledger_previo
  from public.caja_pagos
  where movimiento_id = v_movimiento_id;

  if v_ledger_previo is distinct from coalesce(v_mov.total_pagado, 0) then
    raise exception using errcode = '23514', message = 'MOVIMIENTO_LEDGER_DESCUADRADO';
  end if;

  select coalesce(sum(monto), 0)::numeric(12,2)
    into v_cobertura_previa
  from public.caja_atencion_coberturas
  where movimiento_id = v_movimiento_id and estado = 'APLICADA';

  -- Terapistas: opcional en el payload, pero si llegan deben cubrir a todas las personas.
  if jsonb_array_length(v_terapistas) > 0 then
    if jsonb_array_length(v_terapistas) <> v_mov.n_pax
       or (select count(distinct (x->>'persona')::int) from jsonb_array_elements(v_terapistas) x) <> v_mov.n_pax then
      raise exception using errcode = '22023', message = 'TERAPISTA_POR_PERSONA_REQUERIDA';
    end if;

    for v_item in select value from jsonb_array_elements(v_terapistas)
    loop
      begin v_persona := (v_item->>'persona')::int; exception when others then raise exception using errcode='22023',message='TERAPISTA_PERSONA_INVALIDA'; end;
      v_terapista_nombre := btrim(coalesce(v_item->>'terapista', ''));
      if v_persona not between 1 and v_mov.n_pax or v_terapista_nombre = '' then
        raise exception using errcode = '22023', message = 'TERAPISTA_PERSONA_INVALIDA';
      end if;
      if not exists (
        select 1 from public.config_listas
        where lista='TERAPISTAS' and activo is true and btrim(valor)=v_terapista_nombre
      ) then
        raise exception using errcode = '22023', message = 'TERAPISTA_NO_PERMITIDA';
      end if;
      update public.caja_atencion_detalle
      set terapista = v_terapista_nombre,
          terapista_otro = nullif(btrim(coalesce(v_item->>'terapista_otro','')), '')
      where movimiento_id = v_movimiento_id and persona_n = v_persona;
      if not found then
        raise exception using errcode = '23514', message = 'DETALLE_ATENCION_INCONSISTENTE';
      end if;
    end loop;
  end if;

  -- Extras nuevos del request.
  for v_item in select value from jsonb_array_elements(v_extras)
  loop
    v_tipo := upper(btrim(coalesce(v_item->>'tipo','')));
    v_concepto := btrim(coalesce(v_item->>'concepto',''));
    begin
      v_cantidad := coalesce((v_item->>'cantidad')::numeric, 1);
      v_unitario := (v_item->>'monto_unitario')::numeric;
      v_duracion := coalesce((v_item->>'duracion_extra_min')::int, 0);
      v_persona := nullif(v_item->>'persona_n','')::int;
    exception when others then
      raise exception using errcode='22023',message='EXTRA_INVALIDO';
    end;
    if v_tipo not in ('MINUTOS_EXTRA','PRODUCTO','DECORACION','OTRO')
       or v_concepto = '' or v_cantidad <= 0 or v_unitario < 0 or v_duracion < 0
       or (v_persona is not null and v_persona not between 1 and v_mov.n_pax) then
      raise exception using errcode='22023',message='EXTRA_INVALIDO';
    end if;
    v_monto := round(v_cantidad * v_unitario, 2);
    if v_monto <= 0 then raise exception using errcode='22023',message='EXTRA_INVALIDO'; end if;
    insert into public.caja_atencion_extras(
      movimiento_id,tipo,concepto,cantidad,monto_unitario,monto_total,duracion_extra_min,persona_n,responsable,request_id,metadata
    ) values (
      v_movimiento_id,v_tipo,v_concepto,v_cantidad,v_unitario,v_monto,v_duracion,v_persona,v_responsable,v_request_id,
      coalesce(v_item->'metadata','{}'::jsonb)
    );
    v_extra_nuevo := v_extra_nuevo + v_monto;
  end loop;

  -- Ajustes/descuentos nuevos del request.
  for v_item in select value from jsonb_array_elements(v_ajustes)
  loop
    v_tipo := upper(btrim(coalesce(v_item->>'tipo','')));
    v_motivo := btrim(coalesce(v_item->>'motivo',''));
    begin v_monto := (v_item->>'monto')::numeric; exception when others then raise exception using errcode='22023',message='AJUSTE_INVALIDO'; end;
    if v_tipo not in ('DESCUENTO','CORTESIA','AJUSTE_PRECIO') or v_motivo='' or v_monto<=0 or v_monto<>round(v_monto,2) then
      raise exception using errcode='22023',message='AJUSTE_INVALIDO';
    end if;
    insert into public.caja_atencion_ajustes(movimiento_id,tipo,monto,motivo,responsable,request_id)
    values(v_movimiento_id,v_tipo,v_monto,v_motivo,v_responsable,v_request_id);
    v_ajuste_nuevo := v_ajuste_nuevo + v_monto;
  end loop;

  v_total_cobrar := round(coalesce(v_mov.total_cobrar,0) + v_extra_nuevo - v_ajuste_nuevo, 2);
  if v_total_cobrar < 0 then
    raise exception using errcode='22023',message='AJUSTES_SUPERAN_TOTAL';
  end if;

  -- Si existe un hold activo de Gift Card para este movimiento, V2 exige aplicarlo
  -- explícitamente en el request para no hacer desaparecer cobertura de forma implícita.
  select * into v_hold
  from public.gift_card_reservas
  where movimiento_id = v_movimiento_id and estado='ACTIVA'
  for update;
  if found and not exists (
    select 1 from jsonb_array_elements(v_coberturas) c
    where upper(btrim(coalesce(c->>'tipo','')))='GIFT_CARD'
      and btrim(coalesce(c->>'referencia_id',''))=v_hold.giftcard_id
  ) then
    raise exception using errcode='22023',message='GIFT_CARD_COBERTURA_REQUERIDA';
  end if;

  -- Coberturas nuevas del request.
  for v_item in select value from jsonb_array_elements(v_coberturas)
  loop
    v_tipo := upper(btrim(coalesce(v_item->>'tipo','')));
    v_referencia := nullif(btrim(coalesce(v_item->>'referencia_id','')), '');
    begin v_monto := (v_item->>'monto')::numeric; exception when others then raise exception using errcode='22023',message='COBERTURA_INVALIDA'; end;
    if v_tipo not in ('GIFT_CARD','CONVENIO_BEE','CONVENIO_CUPONIDAD','OTRA_COBERTURA')
       or v_monto<=0 or v_monto<>round(v_monto,2)
       or (v_tipo<>'OTRA_COBERTURA' and v_referencia is null) then
      raise exception using errcode='22023',message='COBERTURA_INVALIDA';
    end if;
    if exists (
      select 1 from public.caja_atencion_coberturas
      where movimiento_id=v_movimiento_id and tipo=v_tipo
        and referencia_id is not distinct from v_referencia and estado='APLICADA'
    ) then
      raise exception using errcode='23505',message='COBERTURA_YA_APLICADA';
    end if;

    if v_tipo='GIFT_CARD' then
      select * into v_hold from public.gift_card_reservas
      where movimiento_id=v_movimiento_id and giftcard_id=v_referencia and estado='ACTIVA'
      for update;
      if not found or v_monto is distinct from v_hold.monto_reservado then
        raise exception using errcode='23514',message='GIFT_CARD_HOLD_NO_COINCIDE';
      end if;
      select * into v_gift from public.gift_cards where giftcard_id=v_referencia for update;
      if not found or v_gift.estado in ('ANULADA','USADA') or v_gift.fecha_vencimiento < v_fecha_hora::date then
        raise exception using errcode='23514',message='GIFT_CARD_NO_CANJEABLE';
      end if;
      select coalesce(sum(monto_usado),0)::numeric(12,2) into v_gift_usado
      from public.gift_card_usos where giftcard_id=v_gift.giftcard_id;
      v_gift_saldo := greatest(coalesce(v_gift.monto,0)-v_gift_usado,0);
      if v_monto > v_gift_saldo then raise exception using errcode='23514',message='GIFT_CARD_SALDO_INSUFICIENTE'; end if;

      insert into public.gift_card_usos(
        giftcard_id,monto_usado,service_code,fecha_uso,hora_uso,responsable,movimiento_id,reserva_id,atencion_movimiento_id,observacion,request_id,request_fingerprint
      ) values (
        v_gift.giftcard_id,v_monto,v_gift.service_code,v_fecha_hora::date,v_fecha_hora::time,v_responsable,
        v_movimiento_id,v_reserva_id,v_movimiento_id,nullif(v_observacion,''),v_request_id,v_fingerprint
      ) returning uso_id into v_uso_id;

      v_gift_estado := case when v_monto = v_gift_saldo then 'USADA' else 'PARCIALMENTE_USADA' end;
      update public.gift_cards
      set estado=v_gift_estado,
          fecha_uso=case when v_gift_estado='USADA' then v_fecha_hora::date else fecha_uso end,
          updated_at=clock_timestamp()
      where giftcard_id=v_gift.giftcard_id;
      update public.gift_card_reservas
      set estado='CANJEADA', redeemed_at=clock_timestamp(), uso_id=v_uso_id
      where id=v_hold.id;
      insert into public.gift_card_eventos(giftcard_id,evento,estado_anterior,estado_nuevo,responsable,referencia_id,metadata)
      values(v_gift.giftcard_id,'CANJE',v_gift.estado,v_gift_estado,v_responsable,v_uso_id::text,
        jsonb_build_object('monto_usado',v_monto,'movimiento_id',v_movimiento_id,'origen','CONCILIACION_ATENCION_V2'));

    elsif v_tipo in ('CONVENIO_BEE','CONVENIO_CUPONIDAD') then
      select * into v_convenio from public.cupones_convenios where registro_id=v_referencia for update;
      if not found then raise exception using errcode='P0002',message='CONVENIO_NO_EXISTE'; end if;
      if (v_tipo='CONVENIO_BEE' and upper(coalesce(v_convenio.plataforma,'')) not like '%BEE%')
         or (v_tipo='CONVENIO_CUPONIDAD' and upper(coalesce(v_convenio.plataforma,'')) not like '%CUPONIDAD%') then
        raise exception using errcode='23514',message='CONVENIO_PLATAFORMA_NO_COINCIDE';
      end if;
      if v_monto is distinct from round(coalesce(v_convenio.monto_reconocido,0),2) or v_monto<=0 then
        raise exception using errcode='23514',message='CONVENIO_MONTO_NO_COINCIDE';
      end if;
    end if;

    insert into public.caja_atencion_coberturas(movimiento_id,tipo,referencia_id,monto,estado,responsable,request_id)
    values(v_movimiento_id,v_tipo,v_referencia,v_monto,'APLICADA',v_responsable,v_request_id);
    v_cobertura_nueva := v_cobertura_nueva + v_monto;
  end loop;

  if v_ledger_previo + v_cobertura_previa + v_cobertura_nueva > v_total_cobrar then
    raise exception using errcode='23514',message='COBERTURAS_O_PAGOS_SUPERAN_TOTAL';
  end if;

  v_pendiente_antes_pagos := greatest(v_total_cobrar - v_ledger_previo - v_cobertura_previa - v_cobertura_nueva, 0);

  -- Pagos reales de Vita Lima. Cada método genera su propia fila de ledger.
  for v_item in select value from jsonb_array_elements(v_pagos)
  loop
    v_metodo := upper(btrim(coalesce(v_item->>'metodo','')));
    v_operacion := nullif(btrim(coalesce(v_item->>'numero_operacion','')), '');
    begin v_monto := (v_item->>'monto')::numeric; exception when others then raise exception using errcode='22023',message='PAGO_INVALIDO'; end;
    if v_monto<=0 or v_monto<>round(v_monto,2) or v_metodo='' then
      raise exception using errcode='22023',message='PAGO_INVALIDO';
    end if;
    if not exists (
      select 1 from public.config_listas where lista='METODOS_PAGO' and activo is true and upper(btrim(valor))=v_metodo
    ) then raise exception using errcode='22023',message='METODO_PAGO_NO_PERMITIDO'; end if;
    if v_metodo<>'EFECTIVO' and v_operacion is null then
      raise exception using errcode='22023',message='NUMERO_OPERACION_REQUERIDO';
    end if;
    if v_pago_nuevo + v_monto > v_pendiente_antes_pagos then
      raise exception using errcode='22023',message='PAGOS_SUPERAN_PENDIENTE';
    end if;
    v_pago_id := 'PAY-V2-'||upper(replace(extensions.gen_random_uuid()::text,'-',''));
    insert into public.caja_pagos(
      pago_id,movimiento_id,fecha,hora,sede,tipo_pago,metodo,metodo_detalle,monto,concepto,numero_operacion
    ) values (
      v_pago_id,v_movimiento_id,v_fecha_hora::date,v_fecha_hora::time,v_mov.sede,'SALDO_ATENCION_V2',
      v_metodo,null,v_monto,coalesce(nullif(v_mov.servicio,''),'Atención'),v_operacion
    );
    v_pago_nuevo := v_pago_nuevo + v_monto;
  end loop;

  v_ledger_final := v_ledger_previo + v_pago_nuevo;
  v_pendiente := greatest(v_total_cobrar - v_ledger_final - v_cobertura_previa - v_cobertura_nueva, 0);

  -- Propina: dinero de terceros. Se valida el medio, pero nunca entra en caja_pagos.
  if v_propina is not null then
    begin v_propina_monto := (v_propina->>'monto')::numeric; exception when others then raise exception using errcode='22023',message='PROPINA_INVALIDA'; end;
    v_metodo := upper(btrim(coalesce(v_propina->>'metodo','')));
    v_operacion := nullif(btrim(coalesce(v_propina->>'numero_operacion','')), '');
    if v_propina_monto<=0 or v_propina_monto<>round(v_propina_monto,2) or v_metodo='' then
      raise exception using errcode='22023',message='PROPINA_INVALIDA';
    end if;
    if not exists (
      select 1 from public.config_listas where lista='METODOS_PAGO' and activo is true and upper(btrim(valor))=v_metodo
    ) then raise exception using errcode='22023',message='METODO_PROPINA_NO_PERMITIDO'; end if;
    if v_metodo<>'EFECTIVO' and v_operacion is null then raise exception using errcode='22023',message='NUMERO_OPERACION_PROPINA_REQUERIDO'; end if;
    if jsonb_typeof(coalesce(v_propina->'distribucion','[]'::jsonb))<>'array'
       or jsonb_array_length(coalesce(v_propina->'distribucion','[]'::jsonb))=0 then
      raise exception using errcode='22023',message='DISTRIBUCION_PROPINA_REQUERIDA';
    end if;

    v_propina_distribuida := 0;
    for v_dist in select value from jsonb_array_elements(v_propina->'distribucion')
    loop
      begin
        v_terapista_id := (v_dist->>'terapista_id')::uuid;
        v_monto := (v_dist->>'monto')::numeric;
      exception when others then raise exception using errcode='22023',message='DISTRIBUCION_PROPINA_INVALIDA'; end;
      if v_monto<=0 or v_monto<>round(v_monto,2)
         or not exists(select 1 from public.terapistas where terapista_id=v_terapista_id and estado='ACTIVA') then
        raise exception using errcode='22023',message='DISTRIBUCION_PROPINA_INVALIDA';
      end if;
      if exists (
        select 1 from jsonb_array_elements(v_propina->'distribucion') d
        where (d->>'terapista_id')::uuid=v_terapista_id
        group by d->>'terapista_id' having count(*)>1
      ) then raise exception using errcode='22023',message='TERAPISTA_PROPINA_DUPLICADA'; end if;
      v_propina_distribuida := v_propina_distribuida + v_monto;
    end loop;
    if round(v_propina_distribuida,2) is distinct from v_propina_monto then
      raise exception using errcode='22023',message='PROPINA_DISTRIBUCION_NO_CUADRA';
    end if;

    insert into public.caja_propinas(movimiento_id,fecha,hora,sede,metodo,numero_operacion,monto,estado,responsable,request_id)
    values(v_movimiento_id,v_fecha_hora::date,v_fecha_hora::time,v_mov.sede,v_metodo,v_operacion,v_propina_monto,'PENDIENTE',v_responsable,v_request_id)
    returning propina_id into v_propina_id;

    for v_dist in select value from jsonb_array_elements(v_propina->'distribucion')
    loop
      insert into public.caja_propina_distribucion(propina_id,terapista_id,monto,estado)
      values(v_propina_id,(v_dist->>'terapista_id')::uuid,(v_dist->>'monto')::numeric,'PENDIENTE');
    end loop;
  end if;

  v_estado_movimiento := case when v_pendiente=0 then 'Atendido' else 'En atención' end;
  v_estado_reserva := case when v_pendiente=0 then 'ATENDIDA_APP' else 'EN_ATENCION' end;

  update public.caja_movimientos
  set tipo_movimiento='ATENCION_APP',
      estado=v_estado_movimiento,
      total_extras=round(coalesce(total_extras,0)+v_extra_nuevo,2),
      total_cobrar=v_total_cobrar,
      total_pagado=v_ledger_final,
      pendiente=v_pendiente,
      responsable=v_responsable,
      observacion=case when v_observacion='' then observacion else concat_ws(E'\n',nullif(observacion,''),v_observacion) end,
      updated_at=now()
  where movimiento_id=v_movimiento_id;

  if v_reserva_id is not null then
    update public.citas_reservadas
    set monto_total=v_total_cobrar,
        saldo_pendiente=v_pendiente,
        estado=v_estado_reserva,
        observacion=case when v_observacion='' then observacion else concat_ws(E'\n',nullif(observacion,''),v_observacion) end,
        updated_at=now()
    where reserva_id=v_reserva_id;
  end if;

  v_respuesta := jsonb_build_object(
    'ok',true,
    'reutilizado',false,
    'movimiento_id',v_movimiento_id,
    'reserva_id',v_reserva_id,
    'extras_agregados',v_extra_nuevo,
    'ajustes_agregados',v_ajuste_nuevo,
    'coberturas_agregadas',v_cobertura_nueva,
    'pagos_agregados',v_pago_nuevo,
    'propina_registrada',coalesce(v_propina_monto,0),
    'total_cobrar',v_total_cobrar,
    'total_pagado',v_ledger_final,
    'coberturas_totales',v_cobertura_previa+v_cobertura_nueva,
    'pendiente',v_pendiente,
    'estado_movimiento',v_estado_movimiento,
    'estado_reserva',case when v_reserva_id is null then null else v_estado_reserva end,
    'completada',v_pendiente=0
  );

  insert into public.caja_conciliacion_atencion_requests(request_id,request_fingerprint,movimiento_id,reserva_id,respuesta)
  values(v_request_id,v_fingerprint,v_movimiento_id,v_reserva_id,v_respuesta);

  return v_respuesta;
end;
$$;

revoke all on function public.conciliar_atencion_v2(jsonb) from public, anon, authenticated;
grant execute on function public.conciliar_atencion_v2(jsonb) to service_role;

comment on function public.conciliar_atencion_v2(jsonb) is
  'Conciliación V2 incremental e idempotente: extras, ajustes, coberturas, pagos múltiples, Gift Card y propina sin doble contabilización.';

commit;

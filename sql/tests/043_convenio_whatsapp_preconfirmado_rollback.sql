-- QA aislado para sql/043_convenio_whatsapp_preconfirmado.sql
begin;

do $$
declare
  v_result jsonb;
  v_count integer;
begin
  begin
    perform public.preparar_ficha_convenio_v1(
      jsonb_build_object(
        'request_id', '43000000-0000-4000-8000-000000000001',
        'canal', 'bee',
        'fecha', ((now() at time zone 'America/Lima')::date + 1)::text,
        'hora', '12:00',
        'sede', 'Miraflores',
        'responsable', 'QA',
        'movimiento_id', 'MOV-QA-WA-INVALIDO',
        'reserva_id', 'RES-QA-WA-INVALIDO',
        'token', repeat('B', 43),
        'token_expira', (now() + interval '30 days')::text
      )
    );
    raise exception 'QA_CONVENIO_ACEPTO_WHATSAPP_VACIO';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'WHATSAPP_CONVENIO_INVALIDO' then
        raise;
      end if;
  end;

  select public.preparar_ficha_convenio_v1(
    jsonb_build_object(
      'request_id', '43000000-0000-4000-8000-000000000002',
      'canal', 'bee',
      'fecha', ((now() at time zone 'America/Lima')::date + 1)::text,
      'hora', '12:30',
      'sede', 'Miraflores',
      'whatsapp_e164', '+51987654321',
      'responsable', 'QA',
      'movimiento_id', 'MOV-QA-WA-001',
      'reserva_id', 'RES-QA-WA-001',
      'token', repeat('C', 43),
      'token_expira', (now() + interval '30 days')::text
    )
  ) into v_result;

  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'QA_CONVENIO_WHATSAPP_PREPARACION_FALLO';
  end if;

  if not exists (
    select 1
    from public.citas_reservadas
    where reserva_id = 'RES-QA-WA-001'
      and canal = 'bee'
      and whatsapp = '+51987654321'
      and cliente_id is null
      and estado_ficha = 'pendiente'
  ) then
    raise exception 'QA_CONVENIO_WHATSAPP_NO_QUEDA_EN_RESERVA';
  end if;

  if not exists (
    select 1
    from public.caja_movimientos
    where movimiento_id = 'MOV-QA-WA-001'
      and whatsapp = '+51987654321'
      and total_pagado = 0
      and total_cobrar = 0
  ) then
    raise exception 'QA_CONVENIO_WHATSAPP_NO_QUEDA_EN_MOVIMIENTO';
  end if;

  select count(*) into v_count
  from public.caja_pagos
  where movimiento_id = 'MOV-QA-WA-001';

  if v_count <> 0 then
    raise exception 'QA_CONVENIO_WHATSAPP_CREO_PAGO';
  end if;
end;
$$;

rollback;

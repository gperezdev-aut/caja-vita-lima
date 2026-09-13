-- Harness transaccional Gift Cards v1. Requiere migraciones 001..023 y catálogo activo.
begin;

do $$
declare
  v_service text; v_service_price numeric; v_service_result jsonb; v_amount_result jsonb;
  v_service_code text; v_amount_code text; v_replay jsonb; v_payments_before bigint;
  v_partial jsonb; v_second jsonb; v_expired jsonb; v_annulled jsonb;
begin
  select s.service_code,s.price_pen into v_service,v_service_price
  from public.caja_catalog_services s join public.caja_catalog_releases r using(release_id)
  where r.active and s.active order by s.service_code limit 1;
  if v_service is null then raise exception 'HARNESS_REQUIERE_CATALOGO_ACTIVO'; end if;

  -- A/C/D/G. Emisión por servicio, fecha +1 year, código no secuencial y pago asociado.
  v_service_result:=public.emitir_gift_card_v1(jsonb_build_object(
    'request_id','23000000-0000-0000-0000-000000000001','tipo','SERVICIO','service_code',v_service,
    'comprador','Harness Comprador','beneficiario','Harness Servicio','whatsapp_comprador','+51987654321',
    'sede','Miraflores','metodo_pago','EFECTIVO','monto_recibido',v_service_price,'responsable','HARNESS'));
  v_service_code:=v_service_result->>'codigo';
  if v_service_code !~ '^GC-VITA-[A-Z0-9]{8}$' then raise exception 'CODIGO_INVALIDO'; end if;
  if not exists(select 1 from public.gift_cards where codigo=v_service_code and tipo='SERVICIO' and service_code=v_service and fecha_vencimiento=(fecha_emision+interval '1 year')::date and catalog_release_id is not null and catalog_price_version is not null) then raise exception 'EMISION_SERVICIO_INVALIDA'; end if;
  if not exists(select 1 from public.gift_cards g join public.caja_movimientos m on m.movimiento_id=g.movimiento_id join public.caja_pagos p on p.pago_id=g.pago_id and p.movimiento_id=m.movimiento_id where g.codigo=v_service_code and m.tipo_movimiento='GIFT_CARD_VENTA' and p.tipo_pago='GIFT_CARD_VENTA' and p.monto=v_service_price) then raise exception 'LEDGER_EMISION_INVALIDO'; end if;

  -- B. Emisión por monto.
  v_amount_result:=public.emitir_gift_card_v1('{"request_id":"23000000-0000-0000-0000-000000000002","tipo":"MONTO","monto":200,"comprador":"Harness Comprador","beneficiario":"Harness Monto","sede":"Miraflores","metodo_pago":"YAPE","numero_operacion":"OP-023","monto_recibido":200,"responsable":"HARNESS"}'::jsonb);
  v_amount_code:=v_amount_result->>'codigo';
  if not exists(select 1 from public.vista_gift_cards_operativa where codigo=v_amount_code and tipo='MONTO' and saldo_restante=200) then raise exception 'EMISION_MONTO_INVALIDA'; end if;

  -- E. Replay idéntico devuelve el mismo resultado y no duplica filas.
  v_replay:=public.emitir_gift_card_v1('{"request_id":"23000000-0000-0000-0000-000000000002","tipo":"MONTO","monto":200,"comprador":"Harness Comprador","beneficiario":"Harness Monto","sede":"Miraflores","metodo_pago":"YAPE","numero_operacion":"OP-023","monto_recibido":200,"responsable":"HARNESS"}'::jsonb);
  if not coalesce((v_replay->>'reutilizado')::boolean,false) or v_replay->>'codigo'<>v_amount_code then raise exception 'IDEMPOTENCIA_FALLO'; end if;
  if (select count(*) from public.gift_cards where request_id='23000000-0000-0000-0000-000000000002')<>1 then raise exception 'IDEMPOTENCIA_DUPLICO'; end if;

  -- F. Mismo request_id con payload distinto falla cerrado.
  begin
    perform public.emitir_gift_card_v1('{"request_id":"23000000-0000-0000-0000-000000000002","tipo":"MONTO","monto":201,"comprador":"Harness Comprador","beneficiario":"Harness Monto","sede":"Miraflores","metodo_pago":"YAPE","numero_operacion":"OP-023","monto_recibido":201,"responsable":"HARNESS"}'::jsonb);
    raise exception 'CONFLICTO_NO_RECHAZADO';
  exception when unique_violation then null; end;

  -- H. Servicio se consume una sola vez.
  perform public.canjear_gift_card_v1(jsonb_build_object('request_id','23000000-0000-0000-0000-000000000003','codigo',v_service_code,'responsable','HARNESS'));
  if not exists(select 1 from public.gift_cards where codigo=v_service_code and estado='USADA') then raise exception 'CANJE_SERVICIO_INVALIDO'; end if;
  begin perform public.canjear_gift_card_v1(jsonb_build_object('request_id','23000000-0000-0000-0000-000000000004','codigo',v_service_code,'responsable','HARNESS')); raise exception 'DOBLE_CANJE_SERVICIO'; exception when sqlstate '22023' then null; end;

  -- I/J. Dos canjes parciales independientes preservan historial y saldo reconstruible.
  select count(*) into v_payments_before from public.caja_pagos;
  v_partial:=public.canjear_gift_card_v1(jsonb_build_object('request_id','23000000-0000-0000-0000-000000000005','codigo',v_amount_code,'monto_usado',150,'responsable','HARNESS'));
  v_second:=public.canjear_gift_card_v1(jsonb_build_object('request_id','23000000-0000-0000-0000-000000000006','codigo',v_amount_code,'monto_usado',25,'responsable','HARNESS'));
  if (v_partial->>'saldo_restante')::numeric<>50 or (v_second->>'saldo_restante')::numeric<>25 then raise exception 'SALDO_PARCIAL_INVALIDO'; end if;
  if (select count(*) from public.gift_card_usos u join public.gift_cards g using(giftcard_id) where g.codigo=v_amount_code)<>2 then raise exception 'HISTORIAL_USOS_INVALIDO'; end if;

  -- K. Saldo insuficiente se rechaza.
  begin perform public.canjear_gift_card_v1(jsonb_build_object('request_id','23000000-0000-0000-0000-000000000007','codigo',v_amount_code,'monto_usado',26,'responsable','HARNESS')); raise exception 'SALDO_INSUFICIENTE_NO_RECHAZADO'; exception when sqlstate '22023' then null; end;

  -- L. Vencida por lectura efectiva no se canjea.
  v_expired:=public.emitir_gift_card_v1('{"request_id":"23000000-0000-0000-0000-000000000008","tipo":"MONTO","monto":100,"comprador":"Harness","beneficiario":"Vencida","sede":"Miraflores","metodo_pago":"EFECTIVO","monto_recibido":100,"responsable":"HARNESS"}'::jsonb);
  update public.gift_cards set fecha_vencimiento=(now() at time zone 'America/Lima')::date-1 where codigo=v_expired->>'codigo';
  if not exists(select 1 from public.vista_gift_cards_operativa where codigo=v_expired->>'codigo' and estado_efectivo='VENCIDA') then raise exception 'VENCIMIENTO_LECTURA_INVALIDO'; end if;
  begin perform public.canjear_gift_card_v1(jsonb_build_object('request_id','23000000-0000-0000-0000-000000000009','codigo',v_expired->>'codigo','monto_usado',1,'responsable','HARNESS')); raise exception 'VENCIDA_CANJEADA'; exception when sqlstate '22023' then null; end;

  -- M. Anulada conserva pago e historial, sin devolución automática.
  v_annulled:=public.emitir_gift_card_v1('{"request_id":"23000000-0000-0000-0000-000000000010","tipo":"MONTO","monto":100,"comprador":"Harness","beneficiario":"Anulada","sede":"Miraflores","metodo_pago":"EFECTIVO","monto_recibido":100,"responsable":"HARNESS"}'::jsonb);
  perform public.anular_gift_card_v1(jsonb_build_object('codigo',v_annulled->>'codigo','motivo','Prueba administrativa','responsable','HARNESS'));
  if not exists(select 1 from public.gift_cards where codigo=v_annulled->>'codigo' and estado='ANULADA' and motivo_anulacion='Prueba administrativa' and pago_id is not null) then raise exception 'ANULACION_INVALIDA'; end if;

  -- N. La fila se bloquea en cada canje; solicitudes concurrentes serializan el saldo.
  if position('FOR UPDATE' in upper(pg_get_functiondef('public.canjear_gift_card_v1(jsonb)'::regprocedure)))=0 then raise exception 'CANJE_SIN_LOCK'; end if;

  -- O. Los canjes no crean pagos: el ingreso existe solo en la venta.
  if (select count(*) from public.caja_pagos)<>v_payments_before+2 then raise exception 'DOBLE_CONTABILIZACION'; end if;

  -- P. Tablas/RPC privadas, ejecución solo service_role.
  if has_function_privilege('anon','public.emitir_gift_card_v1(jsonb)','EXECUTE') or has_function_privilege('authenticated','public.canjear_gift_card_v1(jsonb)','EXECUTE') then raise exception 'RPC_PUBLICA'; end if;
  if not has_function_privilege('service_role','public.emitir_gift_card_v1(jsonb)','EXECUTE') or has_table_privilege('anon','public.gift_card_usos','SELECT') then raise exception 'PERMISOS_INVALIDOS'; end if;
end $$;

rollback;

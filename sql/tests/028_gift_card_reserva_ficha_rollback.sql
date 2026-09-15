-- Contrato transaccional 028. Todos los datos de QA se revierten.
begin;

do $$
declare
  v_service jsonb; v_amount jsonb; v_hold jsonb; v_replay jsonb; v_second jsonb; v_attention jsonb;
  v_gc_service text; v_gc_amount text; v_payments int; v_date date:=current_date+1;
  v_base jsonb;
begin
  -- CASE_01 SERVICIO crea hold sin canjear; la venta ya creó caja_pagos.
  v_service:=public.emitir_gift_card_v1(jsonb_build_object('request_id','28000000-0000-4000-8000-000000000001','tipo','SERVICIO','service_code','SVC_016','comprador','QA comprador','beneficiario','QA servicio','whatsapp_beneficiario','+51987654321','sede','Miraflores','metodo_pago','YAPE','numero_operacion','QA-VENTA-S','monto_recibido',70,'responsable','QA'));
  v_gc_service:=v_service->>'giftcard_id';
  select count(*) into v_payments from public.caja_pagos;
  v_base:=jsonb_build_object('canal','directo','personas',1,'fecha',v_date,'hora','11:00','sede','Miraflores','tipo_atencion','sede','atencion_personalizada',false,'cliente','QA servicio','whatsapp_e164','+51987654321','pais_telefono','PE','monto_pagado',0,'metodo_pago','','numero_operacion','','responsable','QA','idioma','es','cupon_promocional',null,'cliente_id','CLI-QA-028-S','token_expira',(v_date+time '12:00') at time zone 'America/Lima');
  v_hold:=public.preparar_ficha_cita_gift_card_v1(v_base||jsonb_build_object('request_id','28000000-0000-4000-8000-000000000002','giftcard_id',v_gc_service,'movimiento_id','MOV-QA-028-S1','reserva_id','RES-QA-028-S1','pago_id','PAY-QA-028-S1','token',repeat('S',43),'servicios',jsonb_build_array(jsonb_build_object('codigo','SVC_016'))));
  if not exists(select 1 from public.gift_card_reservas where reserva_id='RES-QA-028-S1' and estado='ACTIVA' and monto_reservado=70) or exists(select 1 from public.gift_card_usos where giftcard_id=v_gc_service) then raise exception 'CASE_01'; end if;
  if (select count(*) from public.caja_pagos)<>v_payments then raise exception 'CASE_17_COBERTURA_CREO_PAGO'; end if;

  -- CASE_02 SERVICIO no permite segundo hold activo.
  begin perform public.preparar_ficha_cita_gift_card_v1(v_base||jsonb_build_object('request_id','28000000-0000-4000-8000-000000000003','giftcard_id',v_gc_service,'movimiento_id','MOV-QA-028-S2','reserva_id','RES-QA-028-S2','pago_id','PAY-QA-028-S2','token',repeat('T',43),'servicios',jsonb_build_array(jsonb_build_object('codigo','SVC_016')))); raise exception 'CASE_02'; exception when sqlstate '22023' then null; end;

  -- CASE_14 replay idéntico / CASE_15 payload distinto.
  v_replay:=public.preparar_ficha_cita_gift_card_v1(v_base||jsonb_build_object('request_id','28000000-0000-4000-8000-000000000002','giftcard_id',v_gc_service,'movimiento_id','MOV-IGNORED','reserva_id','RES-IGNORED','pago_id','PAY-IGNORED','token',repeat('X',43),'servicios',jsonb_build_array(jsonb_build_object('codigo','SVC_016'))));
  if not coalesce((v_replay->>'reutilizado')::boolean,false) or v_replay->>'reserva_id'<>'RES-QA-028-S1' then raise exception 'CASE_14'; end if;
  begin perform public.preparar_ficha_cita_gift_card_v1((v_base||jsonb_build_object('cliente','OTRO'))||jsonb_build_object('request_id','28000000-0000-4000-8000-000000000002','giftcard_id',v_gc_service,'movimiento_id','MOV-X','reserva_id','RES-X','pago_id','PAY-X','token',repeat('X',43),'servicios',jsonb_build_array(jsonb_build_object('codigo','SVC_016')))); raise exception 'CASE_15'; exception when unique_violation then null; end;

  -- CASE_03 liberar permite reservar otra vez / CASE_13 no crea uso.
  perform public.liberar_reserva_gift_card_v1(jsonb_build_object('request_id','28000000-0000-4000-8000-000000000004','giftcard_id',v_gc_service,'reserva_id','RES-QA-028-S1','responsable','QA'));
  if exists(select 1 from public.gift_card_usos where giftcard_id=v_gc_service) or not exists(select 1 from public.gift_card_reservas where reserva_id='RES-QA-028-S1' and estado='LIBERADA') then raise exception 'CASE_03_CASE_13'; end if;
  v_hold:=public.preparar_ficha_cita_gift_card_v1(v_base||jsonb_build_object('request_id','28000000-0000-4000-8000-000000000005','giftcard_id',v_gc_service,'movimiento_id','MOV-QA-028-S3','reserva_id','RES-QA-028-S3','pago_id','PAY-QA-028-S3','token',repeat('U',43),'servicios',jsonb_build_array(jsonb_build_object('codigo','SVC_016'))));

  -- CASE_16 canje manual no invade holds.
  begin perform public.canjear_gift_card_v1(jsonb_build_object('request_id','28000000-0000-4000-8000-000000000006','codigo',v_service->>'codigo','responsable','QA')); raise exception 'CASE_16'; exception when sqlstate '22023' then null; end;

  -- CASE_10/12 canje SERVICIO completo al confirmar atención; CASE_19 saldo correcto.
  v_attention:=public.iniciar_o_cerrar_atencion_reservada_gift_card_v1(jsonb_build_object('request_id','28000000-0000-4000-8000-000000000007','movimiento_id','MOV-QA-028-S3','reserva_id','RES-QA-028-S3','responsable','QA','pago_restante',0,'metodo_pago','','numero_operacion','','terapistas',jsonb_build_array(jsonb_build_object('persona',1,'terapista','Rossana')),'extras','[]'::jsonb,'observacion','QA'));
  if (v_attention->>'pendiente')::numeric<>0 or not (v_attention->>'completada')::boolean or not exists(select 1 from public.gift_card_reservas where reserva_id='RES-QA-028-S3' and estado='CANJEADA') or (select estado from public.gift_cards where giftcard_id=v_gc_service)<>'USADA' then raise exception 'CASE_10_CASE_12_CASE_19'; end if;

  -- CASE_04 MONTO reserva parcial; CASE_05 no sobre-reserva; CASE_06 lock FOR UPDATE serializa.
  v_amount:=public.emitir_gift_card_v1(jsonb_build_object('request_id','28000000-0000-4000-8000-000000000008','tipo','MONTO','monto',100,'comprador','QA comprador','beneficiario','QA monto','sede','Miraflores','metodo_pago','EFECTIVO','monto_recibido',100,'responsable','QA'));
  v_gc_amount:=v_amount->>'giftcard_id';
  v_hold:=public.preparar_ficha_cita_gift_card_v1(v_base||jsonb_build_object('request_id','28000000-0000-4000-8000-000000000009','giftcard_id',v_gc_amount,'movimiento_id','MOV-QA-028-M1','reserva_id','RES-QA-028-M1','pago_id','PAY-QA-028-M1','token',repeat('M',43),'servicios',jsonb_build_array(jsonb_build_object('codigo','SVC_016'))));
  v_second:=public.preparar_ficha_cita_gift_card_v1((v_base||jsonb_build_object('cliente','QA monto 2','whatsapp_e164','+51987654322'))||jsonb_build_object('request_id','28000000-0000-4000-8000-000000000010','giftcard_id',v_gc_amount,'movimiento_id','MOV-QA-028-M2','reserva_id','RES-QA-028-M2','pago_id','PAY-QA-028-M2','token',repeat('N',43),'servicios',jsonb_build_array(jsonb_build_object('codigo','SVC_016'))));
  if (v_hold->>'monto_reservado_gift_card')::numeric<>70 or (v_second->>'monto_reservado_gift_card')::numeric<>30 or (select saldo_disponible from public.vista_gift_cards_operativa where giftcard_id=v_gc_amount)<>0 then raise exception 'CASE_04_CASE_05_CASE_06'; end if;

  -- CASE_11 MONTO consume exactamente el hold.
  perform public.iniciar_o_cerrar_atencion_reservada_gift_card_v1(jsonb_build_object('request_id','28000000-0000-4000-8000-000000000011','movimiento_id','MOV-QA-028-M1','reserva_id','RES-QA-028-M1','responsable','QA','pago_restante',0,'metodo_pago','','numero_operacion','','terapistas',jsonb_build_array(jsonb_build_object('persona',1,'terapista','Rossana')),'extras','[]'::jsonb));
  if (select monto_usado from public.gift_card_usos where reserva_id='RES-QA-028-M1')<>70 then raise exception 'CASE_11'; end if;

  -- CASE_18 pago real complementario sí crea caja_pago.
  perform public.liberar_reserva_gift_card_v1(jsonb_build_object('request_id','28000000-0000-4000-8000-000000000012','giftcard_id',v_gc_amount,'reserva_id','RES-QA-028-M2','responsable','QA'));
  v_hold:=public.preparar_ficha_cita_gift_card_v1((v_base||jsonb_build_object('monto_pagado',10,'metodo_pago','EFECTIVO'))||jsonb_build_object('request_id','28000000-0000-4000-8000-000000000013','giftcard_id',v_gc_amount,'movimiento_id','MOV-QA-028-M3','reserva_id','RES-QA-028-M3','pago_id','PAY-QA-028-M3','token',repeat('P',43),'servicios',jsonb_build_array(jsonb_build_object('codigo','SVC_016'))));
  if not exists(select 1 from public.caja_pagos where pago_id='PAY-QA-028-M3' and monto=10) then raise exception 'CASE_18'; end if;

  -- CASE_07/08/09 estados no utilizables.
  update public.gift_cards set fecha_vencimiento=current_date-1 where giftcard_id=v_gc_amount;
  begin perform public.preparar_ficha_cita_gift_card_v1(v_base||jsonb_build_object('request_id','28000000-0000-4000-8000-000000000014','giftcard_id',v_gc_amount)); raise exception 'CASE_07'; exception when sqlstate '22023' then null; end;
  v_amount:=public.emitir_gift_card_v1(jsonb_build_object('request_id','28000000-0000-4000-8000-000000000015','tipo','MONTO','monto',50,'comprador','QA comprador','beneficiario','QA anulada','sede','Miraflores','metodo_pago','EFECTIVO','monto_recibido',50,'responsable','QA'));
  perform public.anular_gift_card_v1(jsonb_build_object('codigo',v_amount->>'codigo','motivo','QA','responsable','QA'));
  begin perform public.preparar_ficha_cita_gift_card_v1(v_base||jsonb_build_object('request_id','28000000-0000-4000-8000-000000000016','giftcard_id',v_amount->>'giftcard_id')); raise exception 'CASE_08'; exception when sqlstate '22023' then null; end;
  if position('FOR UPDATE' in upper(pg_get_functiondef('public.preparar_ficha_cita_gift_card_v1(jsonb)'::regprocedure)))=0 then raise exception 'CASE_06_SIN_LOCK'; end if;
  if not exists(select 1 from public.gift_cards where giftcard_id=v_gc_service and estado='USADA') then raise exception 'CASE_09'; end if;
  -- CASE_20 lo garantiza el ROLLBACK final.
end $$;

do $$ begin
  if has_table_privilege('anon','public.gift_card_reservas','SELECT') or has_table_privilege('authenticated','public.gift_card_reservas','SELECT') or not has_function_privilege('service_role','public.preparar_ficha_cita_gift_card_v1(jsonb)','EXECUTE') then raise exception 'SEGURIDAD_028_INVALIDA'; end if;
end $$;

rollback;

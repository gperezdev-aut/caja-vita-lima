-- QA transaccional · Google Form -> clientes -> Google Contacts outbox
-- Requiere 034 + 035 + 036 + 037 + 038 ya aplicadas EN ENTORNO DE QA.
-- No ejecutar como cutover. Toda la prueba termina en ROLLBACK.

begin;

-- Abortamos si los fixtures chocan con datos existentes del entorno.
do $$
begin
  if exists (
    select 1 from public.clientes
    where whatsapp_e164 in (
      '+51900000101','+51900000102','+51900000103','+51900000104',
      '+51900000105','+51900000106','+51900000107'
    )
  ) then
    raise exception 'QA_FIXTURE_PHONE_ALREADY_EXISTS';
  end if;
end;
$$;

-- 1. Nuevo teléfono canónico -> INSERTED + outbox PENDING.
do $$
declare r jsonb; cid text;
begin
  r := public.caja_ingestar_cliente_form_v2(
    'QA-FORM-001','QA_SHEET',1,now(),'QA Uno','900000101','+51900000101','PE','CANONICO',
    'QA-DNI-001','qa1@example.test',date '1990-01-01','{"fixture":1}'::jsonb
  );
  if r->>'estado' <> 'SUCCEEDED' or r->>'decision' <> 'INSERTED' then
    raise exception 'QA_01_INSERT_FAILED: %', r;
  end if;
  cid := r->>'cliente_id';
  if (select count(*) from public.clientes where cliente_id=cid and whatsapp_e164='+51900000101') <> 1 then
    raise exception 'QA_01_CLIENT_MISSING';
  end if;
  if (select count(*) from public.cliente_contact_sync_outbox where cliente_id=cid and estado='PENDING') <> 1 then
    raise exception 'QA_01_OUTBOX_MISSING';
  end if;
end;
$$;

-- 2. Misma source_record_id + mismo payload -> idempotente, sin duplicar.
do $$
declare r jsonb;
begin
  r := public.caja_ingestar_cliente_form_v2(
    'QA-FORM-001','QA_SHEET',1,now(),'QA Uno','900000101','+51900000101','PE','CANONICO',
    'QA-DNI-001','qa1@example.test',date '1990-01-01','{"fixture":1}'::jsonb
  );
  if coalesce((r->>'idempotent')::boolean,false) is not true then
    raise exception 'QA_02_NOT_IDEMPOTENT: %', r;
  end if;
  if (select count(*) from public.clientes where whatsapp_e164='+51900000101') <> 1 then
    raise exception 'QA_02_CLIENT_DUPLICATED';
  end if;
end;
$$;

-- 3. Misma source_record_id editada hacia otro E.164 -> revisión permanente,
-- sin crear segundo cliente. Se ejecuta dos veces para probar que un reintento
-- no pueda escapar del bloqueo.
do $$
declare r1 jsonb; r2 jsonb;
begin
  r1 := public.caja_ingestar_cliente_form_v2(
    'QA-FORM-001','QA_SHEET',1,now(),'QA Uno','900000102','+51900000102','PE','CANONICO',
    'QA-DNI-001','qa1@example.test',date '1990-01-01','{"fixture":2}'::jsonb
  );
  r2 := public.caja_ingestar_cliente_form_v2(
    'QA-FORM-001','QA_SHEET',1,now(),'QA Uno','900000102','+51900000102','PE','CANONICO',
    'QA-DNI-001','qa1@example.test',date '1990-01-01','{"fixture":2}'::jsonb
  );
  if r1->>'decision' <> 'SOURCE_IDENTITY_CHANGED' or r2->>'decision' <> 'SOURCE_IDENTITY_CHANGED' then
    raise exception 'QA_03_SOURCE_CHANGE_NOT_BLOCKED: % / %', r1, r2;
  end if;
  if exists (select 1 from public.clientes where whatsapp_e164='+51900000102') then
    raise exception 'QA_03_SECOND_CLIENT_CREATED';
  end if;
end;
$$;

-- 4. Teléfono no canónico -> revisión, sin cliente ni outbox.
do $$
declare r jsonb;
begin
  r := public.caja_ingestar_cliente_form_v2(
    'QA-FORM-004','QA_SHEET',4,now(),'QA Ambiguo','900000103',null,null,'PENDIENTE_REVISION',
    null,'qa4@example.test',null,'{"fixture":4}'::jsonb
  );
  if r->>'decision' <> 'NO_CANONICO' or r->>'contacts_enqueued' <> 'false' then
    raise exception 'QA_04_NONCANONICAL_FAILED: %', r;
  end if;
end;
$$;

-- 5. E.164 existente + DNI contradictorio -> revisión, no modifica maestro.
do $$
declare r jsonb;
begin
  r := public.caja_ingestar_cliente_form_v2(
    'QA-FORM-005','QA_SHEET',5,now(),'Otra Persona','900000101','+51900000101','PE','CANONICO',
    'QA-DNI-DISTINTO','qa1@example.test',null,'{"fixture":5}'::jsonb
  );
  if r->>'decision' <> 'CONFLICTO_IDENTIDAD_MISMO_WHATSAPP' then
    raise exception 'QA_05_SAME_PHONE_IDENTITY_CONFLICT_NOT_BLOCKED: %', r;
  end if;
  if (select dni from public.clientes where whatsapp_e164='+51900000101') <> 'QA-DNI-001' then
    raise exception 'QA_05_MASTER_WAS_OVERWRITTEN';
  end if;
end;
$$;

-- 6. E.164 nuevo + DNI ya ligado a otro E.164 -> revisión, no insert.
do $$
declare r jsonb;
begin
  r := public.caja_ingestar_cliente_form_v2(
    'QA-FORM-006','QA_SHEET',6,now(),'QA Duplicado Identidad','900000103','+51900000103','PE','CANONICO',
    'QA-DNI-001','otro@example.test',null,'{"fixture":6}'::jsonb
  );
  if r->>'decision' <> 'CONFLICTO_IDENTIDAD' then
    raise exception 'QA_06_DNI_CONFLICT_NOT_BLOCKED: %', r;
  end if;
  if exists (select 1 from public.clientes where whatsapp_e164='+51900000103') then
    raise exception 'QA_06_CONFLICT_CLIENT_CREATED';
  end if;
end;
$$;

-- 7. Cliente existente por E.164 con campos fuertes vacíos -> completa, no duplica.
do $$
declare r1 jsonb; r2 jsonb; cid text;
begin
  r1 := public.caja_ingestar_cliente_form_v2(
    'QA-FORM-007A','QA_SHEET',7,now(),'QA Siete','900000104','+51900000104','PE','CANONICO',
    null,null,null,'{"fixture":"7a"}'::jsonb
  );
  cid := r1->>'cliente_id';
  r2 := public.caja_ingestar_cliente_form_v2(
    'QA-FORM-007B','QA_SHEET',8,now(),'QA Siete','900000104','+51900000104','PE','CANONICO',
    'QA-DNI-007','qa7@example.test',null,'{"fixture":"7b"}'::jsonb
  );
  if r2->>'decision' <> 'UPDATED' then
    raise exception 'QA_07_EXISTING_PHONE_NOT_UPDATED: %', r2;
  end if;
  if (select count(*) from public.clientes where whatsapp_e164='+51900000104') <> 1 then
    raise exception 'QA_07_DUPLICATED';
  end if;
  if not exists (
    select 1 from public.clientes
    where cliente_id=cid and dni='QA-DNI-007' and email='qa7@example.test'
  ) then
    raise exception 'QA_07_FIELDS_NOT_FILLED';
  end if;
end;
$$;

-- 8. Fencing: token A vence, token B reclama; A no puede finalizar, B sí.
do $$
declare
  r jsonb; cid text; s bigint; token_a text; token_b text; f jsonb;
begin
  r := public.caja_ingestar_cliente_form_v2(
    'QA-FORM-008','QA_SHEET',9,now(),'QA Ocho','900000105','+51900000105','PE','CANONICO',
    'QA-DNI-008','qa8@example.test',null,'{"fixture":8}'::jsonb
  );
  cid := r->>'cliente_id';

  select q.sync_id,q.processing_token into s,token_a
  from public.caja_contact_sync_claim_v2(100,30) q
  where q.cliente_id=cid;

  if s is null or token_a is null then raise exception 'QA_08_FIRST_CLAIM_MISSING'; end if;

  update public.cliente_contact_sync_outbox
  set lease_until=now()-interval '1 second'
  where sync_id=s;

  select q.processing_token into token_b
  from public.caja_contact_sync_claim_v2(100,30) q
  where q.sync_id=s;

  if token_b is null or token_b=token_a then raise exception 'QA_08_SECOND_TOKEN_INVALID'; end if;

  f := public.caja_contact_sync_finish_v2(s,token_a,true,'people/qa-old',null,60);
  if f->>'status' <> 'STALE_CLAIM' then raise exception 'QA_08_OLD_WORKER_NOT_FENCED: %', f; end if;

  f := public.caja_contact_sync_finish_v2(s,token_b,true,'people/qa-current',null,60);
  if f->>'status' <> 'FINISHED' or f->>'estado' <> 'SUCCEEDED' then
    raise exception 'QA_08_CURRENT_WORKER_FAILED: %', f;
  end if;
end;
$$;

-- 9. Cinco intentos fallidos -> DEAD.
do $$
declare r jsonb; cid text; i integer; s bigint; tok text; f jsonb;
begin
  r := public.caja_ingestar_cliente_form_v2(
    'QA-FORM-009','QA_SHEET',10,now(),'QA Nueve','900000106','+51900000106','PE','CANONICO',
    'QA-DNI-009','qa9@example.test',null,'{"fixture":9}'::jsonb
  );
  cid := r->>'cliente_id';

  for i in 1..5 loop
    update public.cliente_contact_sync_outbox
    set next_retry_at=now()-interval '1 second', lease_until=null
    where cliente_id=cid;

    select q.sync_id,q.processing_token into s,tok
    from public.caja_contact_sync_claim_v2(100,30) q
    where q.cliente_id=cid;

    if s is null then raise exception 'QA_09_CLAIM_%_MISSING', i; end if;
    f := public.caja_contact_sync_finish_v2(s,tok,false,null,'QA forced failure',60);
  end loop;

  if (select estado from public.cliente_contact_sync_outbox where cliente_id=cid) <> 'DEAD' then
    raise exception 'QA_09_NOT_DEAD_AFTER_5';
  end if;
end;
$$;

-- 10. Un cliente deja de ser CANONICO antes del claim -> no reclamable.
do $$
declare r jsonb; cid text; n integer;
begin
  r := public.caja_ingestar_cliente_form_v2(
    'QA-FORM-010','QA_SHEET',11,now(),'QA Diez','900000107','+51900000107','PE','CANONICO',
    'QA-DNI-010','qa10@example.test',null,'{"fixture":10}'::jsonb
  );
  cid := r->>'cliente_id';

  update public.clientes
  set telefono_estado='PENDIENTE_REVISION'
  where cliente_id=cid;

  select count(*) into n
  from public.caja_contact_sync_claim_v2(100,30) q
  where q.cliente_id=cid;

  if n <> 0 then raise exception 'QA_10_NONCANONICAL_WAS_CLAIMED'; end if;
end;
$$;

-- Integridad global dentro de los fixtures.
do $$
begin
  if exists (
    select whatsapp_e164 from public.clientes
    where whatsapp_e164 like '+519000001%'
    group by whatsapp_e164 having count(*)>1
  ) then
    raise exception 'QA_GLOBAL_DUPLICATED_E164';
  end if;
end;
$$;

select jsonb_build_object(
  'result','CLIENT_FORM_GOOGLE_CONTACTS_QA_OK',
  'qa_clientes',(select count(*) from public.clientes where whatsapp_e164 like '+519000001%'),
  'qa_ingestas',(select count(*) from public.cliente_form_ingestas where source_record_id like 'QA-FORM-%'),
  'qa_outbox',(select count(*) from public.cliente_contact_sync_outbox o join public.clientes c using(cliente_id) where c.whatsapp_e164 like '+519000001%')
) as qa_result;

rollback;

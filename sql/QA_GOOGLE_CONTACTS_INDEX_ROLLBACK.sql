-- QA 039 · índice local Google Contacts
-- Ejecutar únicamente en QA/local con 034–039 aplicadas.
-- Debe terminar en ROLLBACK sin residuos.

begin;

do $$
declare
  v jsonb;
begin
  select public.caja_google_contacts_index_batch_v1(
    'QA-SNAPSHOT-1',
    '[
      {
        "resource_name":"people/qa-contact-a",
        "display_name":"QA Contact A",
        "email":"qa-a@example.com",
        "etag":"etag-a",
        "phones":[{"e164":"+12025550199","raw":"+1 202 555 0199"}]
      },
      {
        "resource_name":"people/qa-contact-b",
        "display_name":"QA Contact B",
        "email":"qa-b@example.com",
        "etag":"etag-b",
        "phones":[{"e164":"+12025550199","raw":"12025550199"}]
      }
    ]'::jsonb
  ) into v;

  if (v->>'contacts_seen')::int <> 2 then
    raise exception 'QA039_BATCH_CONTACT_COUNT';
  end if;

  select public.caja_google_contacts_lookup_phone_v1('+12025550199') into v;
  if (v->>'match_count')::int <> 2 then
    raise exception 'QA039_DUPLICATE_PHONE_NOT_VISIBLE';
  end if;

  -- Reemplazar teléfonos del mismo resource no puede dejar el viejo.
  perform public.caja_google_contacts_index_batch_v1(
    'QA-SNAPSHOT-1',
    '[
      {
        "resource_name":"people/qa-contact-a",
        "display_name":"QA Contact A",
        "email":"qa-a@example.com",
        "etag":"etag-a2",
        "phones":[{"e164":"+12025550198","raw":"+1 202 555 0198"}]
      }
    ]'::jsonb
  );

  select public.caja_google_contacts_lookup_phone_v1('+12025550199') into v;
  if (v->>'match_count')::int <> 1 then
    raise exception 'QA039_STALE_PHONE_NOT_REPLACED';
  end if;

  select public.caja_google_contacts_index_finish_snapshot_v1('QA-SNAPSHOT-1') into v;
  if coalesce((v->>'bootstrap_ready')::boolean, false) is distinct from true then
    raise exception 'QA039_BOOTSTRAP_NOT_READY';
  end if;

  select public.caja_google_contacts_index_status_v1() into v;
  if coalesce((v->>'bootstrap_ready')::boolean, false) is distinct from true then
    raise exception 'QA039_STATUS_NOT_READY';
  end if;

  -- Nuevo snapshot ve solo A: B debe quedar deleted y desaparecer del lookup.
  perform public.caja_google_contacts_index_batch_v1(
    'QA-SNAPSHOT-2',
    '[
      {
        "resource_name":"people/qa-contact-a",
        "display_name":"QA Contact A 2",
        "email":"qa-a@example.com",
        "etag":"etag-a3",
        "phones":[{"e164":"+12025550198","raw":"+1 202 555 0198"}]
      }
    ]'::jsonb
  );

  perform public.caja_google_contacts_index_finish_snapshot_v1('QA-SNAPSHOT-2');

  select public.caja_google_contacts_lookup_phone_v1('+12025550199') into v;
  if (v->>'match_count')::int <> 0 then
    raise exception 'QA039_DELETED_RESOURCE_STILL_MATCHES';
  end if;

  select public.caja_google_contacts_lookup_phone_v1('+12025550198') into v;
  if (v->>'match_count')::int <> 1 then
    raise exception 'QA039_ACTIVE_RESOURCE_MISSING';
  end if;
end;
$$;

select jsonb_build_object(
  'result','GOOGLE_CONTACTS_INDEX_QA_OK',
  'resources',(select count(*) from public.google_contact_resources),
  'phones',(select count(*) from public.google_contact_phones),
  'state',(select public.caja_google_contacts_index_status_v1())
) as qa_result;

rollback;

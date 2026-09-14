-- Gift Cards: frontera mínima de lectura para el detalle del snapshot histórico.
-- Aplicación manual y separada; este archivo no ejecuta cambios remotos por sí solo.
begin;

create or replace function public.caja_gift_card_catalog_history_read_v1(
  p_service_code text,
  p_release_id text,
  p_price_version text
)
returns table (
  service_code text,
  release_id text,
  price_version text,
  included_es text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.service_code, s.release_id, s.price_version, s.included_es
  from public.caja_catalog_services s
  where s.service_code = p_service_code
    and s.release_id = p_release_id
    and s.price_version = p_price_version
  limit 2;
$$;

revoke all on function public.caja_gift_card_catalog_history_read_v1(text, text, text)
  from public, anon, authenticated;
grant execute on function public.caja_gift_card_catalog_history_read_v1(text, text, text)
  to service_role;

comment on function public.caja_gift_card_catalog_history_read_v1(text, text, text) is
  'Lectura exacta y no mutante de included_es para la versión histórica de una Gift Card.';

commit;

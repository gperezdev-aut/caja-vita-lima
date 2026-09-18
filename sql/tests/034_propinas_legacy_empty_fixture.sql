-- Fixture de compatibilidad para Conciliación V2.
-- Reproduce el esquema legacy vacío observado en Supabase antes de 034,
-- incluyendo validadores y una vista dependiente de monto_total.

create table if not exists public.caja_propinas (
  propina_id uuid primary key default extensions.gen_random_uuid(),
  movimiento_id text not null references public.caja_movimientos(movimiento_id) on delete restrict,
  monto_total numeric(12,2) not null check (monto_total > 0),
  fecha_operativa date not null,
  sede text not null check (btrim(sede) <> ''),
  created_at timestamptz not null default now(),
  unique (movimiento_id)
);

create table if not exists public.caja_propina_distribucion (
  distribucion_id uuid primary key default extensions.gen_random_uuid(),
  propina_id uuid not null references public.caja_propinas(propina_id) on delete cascade,
  terapista text not null check (btrim(terapista) <> ''),
  monto numeric(12,2) not null check (monto > 0),
  created_at timestamptz not null default now(),
  unique (propina_id, terapista)
);

create or replace function public.validar_distribucion_propina_v1(p_propina_id uuid)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_monto_total numeric(12,2);
  v_cantidad integer;
  v_distribuido numeric(12,2);
begin
  select monto_total into v_monto_total
  from public.caja_propinas
  where propina_id=p_propina_id;
  if not found then return; end if;

  select count(*)::integer, coalesce(round(sum(monto),2),0)
    into v_cantidad,v_distribuido
  from public.caja_propina_distribucion
  where propina_id=p_propina_id;

  if v_cantidad < 1 or v_cantidad > 2 then
    raise exception using errcode='23514', message='La propina debe distribuirse entre una o dos terapeutas.';
  end if;
  if v_distribuido <> v_monto_total then
    raise exception using errcode='23514', message='La distribucion debe sumar exactamente el total de la propina.';
  end if;
end;
$$;

create or replace function public.trigger_validar_distribucion_propina_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_table_name='caja_propinas' then
    perform public.validar_distribucion_propina_v1(new.propina_id);
    return new;
  end if;
  if tg_op in ('UPDATE','DELETE') then perform public.validar_distribucion_propina_v1(old.propina_id); end if;
  if tg_op in ('INSERT','UPDATE') and (tg_op <> 'UPDATE' or new.propina_id is distinct from old.propina_id) then
    perform public.validar_distribucion_propina_v1(new.propina_id);
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create constraint trigger trg_validar_propina_desde_distribucion
after insert or update or delete on public.caja_propina_distribucion
deferrable initially deferred
for each row execute function public.trigger_validar_distribucion_propina_v1();

create constraint trigger trg_validar_propina_desde_cabecera
after insert or update of monto_total on public.caja_propinas
deferrable initially deferred
for each row execute function public.trigger_validar_distribucion_propina_v1();

create or replace view public.vista_propinas_legacy_fixture as
select movimiento_id, monto_total, fecha_operativa, sede
from public.caja_propinas;

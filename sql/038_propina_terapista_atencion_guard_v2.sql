-- Caja Vita Lima — guard de distribución de propinas V2
-- Migración 038. Ejecutar después de 034-037.
--
-- Impide asignar una propina a una terapista activa que no participó
-- en la atención del movimiento correspondiente.

begin;

create or replace function public.caja_validar_propina_terapista_atencion_v2()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_movimiento_id text;
  v_nombre text;
begin
  select p.movimiento_id
    into v_movimiento_id
  from public.caja_propinas p
  where p.propina_id = new.propina_id;

  if v_movimiento_id is null then
    raise exception using errcode='P0002', message='PROPINA_NO_EXISTE';
  end if;

  select t.nombre
    into v_nombre
  from public.terapistas t
  where t.terapista_id = new.terapista_id
    and t.estado = 'ACTIVA';

  if v_nombre is null then
    raise exception using errcode='23514', message='PROPINA_TERAPISTA_NO_ACTIVA';
  end if;

  if not exists (
    select 1
    from public.caja_atencion_detalle d
    where d.movimiento_id = v_movimiento_id
      and (
        btrim(coalesce(d.terapista,'')) = btrim(v_nombre)
        or (
          btrim(coalesce(d.terapista,'')) = 'Otro'
          and btrim(coalesce(d.terapista_otro,'')) = btrim(v_nombre)
        )
        or exists (
          select 1
          from public.terapista_aliases a
          where a.terapista_id = new.terapista_id
            and btrim(a.alias) = btrim(coalesce(d.terapista,''))
        )
      )
  ) then
    raise exception using errcode='23514', message='PROPINA_TERAPISTA_NO_ATENDIO';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_caja_validar_propina_terapista_atencion_v2
  on public.caja_propina_distribucion;

create trigger trg_caja_validar_propina_terapista_atencion_v2
before insert or update of propina_id, terapista_id
on public.caja_propina_distribucion
for each row
execute function public.caja_validar_propina_terapista_atencion_v2();

revoke all on function public.caja_validar_propina_terapista_atencion_v2()
  from public, anon, authenticated;
grant execute on function public.caja_validar_propina_terapista_atencion_v2()
  to service_role;

comment on function public.caja_validar_propina_terapista_atencion_v2() is
  'Impide distribuir propinas a terapistas que no figuran en el detalle de la atención; admite nombre canónico, alias y Otro+terapista_otro.';

commit;

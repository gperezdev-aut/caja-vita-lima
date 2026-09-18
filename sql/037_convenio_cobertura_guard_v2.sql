-- Caja Vita Lima — guard de convenios para Conciliación V2
-- Migración 037. Ejecutar después de 034-036.
--
-- Impide aplicar Bee/Cuponidad a una atención distinta de la reserva
-- donde el cliente declaró el código. También evita reutilizar un convenio
-- ya canjeado y marca el convenio como canjeado al aplicar la cobertura.

begin;

create or replace function public.caja_validar_cobertura_convenio_v2()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mov public.caja_movimientos%rowtype;
  v_convenio public.cupones_convenios%rowtype;
  v_tipo_plataforma text;
begin
  if new.tipo not in ('CONVENIO_BEE','CONVENIO_CUPONIDAD') or new.estado <> 'APLICADA' then
    return new;
  end if;

  if nullif(btrim(coalesce(new.referencia_id,'')), '') is null then
    raise exception using errcode='22023', message='CONVENIO_REFERENCIA_REQUERIDA';
  end if;

  select * into v_mov
  from public.caja_movimientos
  where movimiento_id = new.movimiento_id
  for update;
  if not found then
    raise exception using errcode='P0002', message='MOVIMIENTO_NO_EXISTE';
  end if;

  select * into v_convenio
  from public.cupones_convenios
  where registro_id = new.referencia_id
  for update;
  if not found then
    raise exception using errcode='P0002', message='CONVENIO_NO_EXISTE';
  end if;

  if nullif(btrim(coalesce(v_convenio.reserva_id,'')), '') is null
     or v_mov.source_id is distinct from v_convenio.reserva_id then
    raise exception using errcode='23514', message='CONVENIO_NO_PERTENECE_A_RESERVA';
  end if;

  if v_convenio.estado = 'canjeado' then
    raise exception using errcode='23514', message='CONVENIO_YA_CANJEADO';
  end if;

  v_tipo_plataforma := case
    when upper(coalesce(v_convenio.plataforma,'')) like '%BEE%' then 'CONVENIO_BEE'
    when upper(coalesce(v_convenio.plataforma,'')) like '%CUPONIDAD%' then 'CONVENIO_CUPONIDAD'
    else null
  end;
  if v_tipo_plataforma is distinct from new.tipo then
    raise exception using errcode='23514', message='CONVENIO_PLATAFORMA_NO_COINCIDE';
  end if;

  if round(coalesce(v_convenio.monto_reconocido,0),2) <= 0
     or round(coalesce(v_convenio.monto_reconocido,0),2) is distinct from round(new.monto,2) then
    raise exception using errcode='23514', message='CONVENIO_MONTO_NO_COINCIDE';
  end if;

  if v_convenio.sede is not null and btrim(v_convenio.sede) <> ''
     and btrim(v_convenio.sede) is distinct from btrim(coalesce(v_mov.sede,'')) then
    raise exception using errcode='23514', message='CONVENIO_SEDE_NO_COINCIDE';
  end if;

  return new;
end;
$$;

create or replace function public.caja_marcar_convenio_canjeado_v2()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.tipo in ('CONVENIO_BEE','CONVENIO_CUPONIDAD') and new.estado='APLICADA' then
    update public.cupones_convenios
    set estado='canjeado'
    where registro_id=new.referencia_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_caja_validar_cobertura_convenio_v2 on public.caja_atencion_coberturas;
create trigger trg_caja_validar_cobertura_convenio_v2
before insert or update of tipo, referencia_id, monto, estado, movimiento_id
on public.caja_atencion_coberturas
for each row
execute function public.caja_validar_cobertura_convenio_v2();

drop trigger if exists trg_caja_marcar_convenio_canjeado_v2 on public.caja_atencion_coberturas;
create trigger trg_caja_marcar_convenio_canjeado_v2
after insert
on public.caja_atencion_coberturas
for each row
execute function public.caja_marcar_convenio_canjeado_v2();

revoke all on function public.caja_validar_cobertura_convenio_v2() from public, anon, authenticated;
revoke all on function public.caja_marcar_convenio_canjeado_v2() from public, anon, authenticated;
grant execute on function public.caja_validar_cobertura_convenio_v2() to service_role;
grant execute on function public.caja_marcar_convenio_canjeado_v2() to service_role;

comment on function public.caja_validar_cobertura_convenio_v2() is
  'Valida que Bee/Cuponidad pertenezca a la misma reserva, sede y monto antes de aplicar cobertura V2.';
comment on function public.caja_marcar_convenio_canjeado_v2() is
  'Marca el convenio como canjeado solo después de insertar una cobertura V2 aplicada.';

commit;

-- Caja Vita Lima — catálogo operativo de beneficios por convenio
-- Migración 043
--
-- Alcance:
-- - Catálogo separado de Cuponidad/Bee.
-- - Asigna únicamente beneficio, duración y número de sesiones.
-- - NO calcula ni registra monto reconocido, comisión, fee, cobertura o pago.
-- - NO marca el cupón como verificado/canjeado.
-- - La lógica económica queda explícitamente fuera de esta fase.

begin;

create table if not exists public.caja_convenio_beneficios (
  beneficio_code text primary key,
  proveedor text not null check (proveedor in ('cuponidad','bee')),
  nombre text not null,
  incluido text,
  duracion_min integer not null check (duracion_min > 0),
  sesiones_total integer not null default 1 check (sesiones_total > 0),
  sede_restringida text,
  activo boolean not null default true,
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cupones_convenios
  add column if not exists beneficio_code text,
  add column if not exists sesiones_total integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'cupones_convenios_beneficio_code_fkey'
      and conrelid = 'public.cupones_convenios'::regclass
  ) then
    alter table public.cupones_convenios
      add constraint cupones_convenios_beneficio_code_fkey
      foreign key (beneficio_code)
      references public.caja_convenio_beneficios(beneficio_code);
  end if;
end;
$$;

insert into public.caja_convenio_beneficios (
  beneficio_code, proveedor, nombre, incluido, duracion_min,
  sesiones_total, sede_restringida, activo, orden
) values
  (
    'CUP-ANTIESTRES-01',
    'cuponidad',
    'Terapia completa antiestrés',
    'Masaje relajante + masaje herbal + reflexología podal + hidratación de manos y pies',
    45, 1, null, true, 10
  ),
  (
    'CUP-ANTIESTRES-02',
    'cuponidad',
    'Terapia completa antiestrés + Facial Express',
    'Masaje relajante + masaje herbal + reflexología podal + hidratación de manos y pies + Facial Express',
    60, 1, null, true, 20
  ),
  (
    'CUP-MASAJE-1S',
    'cuponidad',
    '1 sesión de masaje relajante y descontracturante',
    '1 sesión de masaje relajante y descontracturante',
    30, 1, 'San Borja', true, 30
  ),
  (
    'CUP-MASAJE-3S',
    'cuponidad',
    '3 sesiones de masaje relajante y descontracturante',
    '3 sesiones de masaje relajante y descontracturante; cada sesión dura 30 minutos',
    30, 3, 'San Borja', true, 40
  ),
  (
    'BEE-TERAP-DEPORT-60',
    'bee',
    'Masaje Terapéutico / Deportivo',
    'Sesión de masaje terapéutico / deportivo',
    60, 1, null, true, 10
  ),
  (
    'BEE-PACK-VITA',
    'bee',
    'Pack Vita',
    'Masaje relajante + compresas herbales + piedras calientes + reflexología + exfoliación de espalda + copa de vino o infusión',
    70, 1, null, true, 20
  ),
  (
    'BEE-PACK-RENOVA',
    'bee',
    'Pack Renova',
    'Masaje relajante herbal + bambuterapia + masaje bioenergético con esferas chinas + reflexología + copa de vino o infusión',
    70, 1, null, true, 30
  )
on conflict (beneficio_code) do update
set
  proveedor = excluded.proveedor,
  nombre = excluded.nombre,
  incluido = excluded.incluido,
  duracion_min = excluded.duracion_min,
  sesiones_total = excluded.sesiones_total,
  sede_restringida = excluded.sede_restringida,
  activo = excluded.activo,
  orden = excluded.orden,
  updated_at = now();

create or replace function public.caja_asignar_beneficio_convenio_v1(
  p_registro_id text,
  p_beneficio_code text,
  p_responsable text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cupon public.cupones_convenios%rowtype;
  v_cita public.citas_reservadas%rowtype;
  v_mov public.caja_movimientos%rowtype;
  v_beneficio public.caja_convenio_beneficios%rowtype;
  v_proveedor text;
  v_apertura time;
  v_cierre time;
begin
  if nullif(btrim(coalesce(p_registro_id,'')), '') is null
     or nullif(btrim(coalesce(p_beneficio_code,'')), '') is null
     or nullif(btrim(coalesce(p_responsable,'')), '') is null then
    raise exception using errcode='22023', message='ASIGNACION_BENEFICIO_INCOMPLETA';
  end if;

  select * into v_cupon
  from public.cupones_convenios
  where registro_id = btrim(p_registro_id)
  for update;

  if not found then
    raise exception using errcode='P0002', message='CONVENIO_NO_EXISTE';
  end if;

  if v_cupon.estado = 'canjeado' then
    raise exception using errcode='23514', message='CONVENIO_YA_CANJEADO';
  end if;

  if nullif(btrim(coalesce(v_cupon.reserva_id,'')), '') is null
     or nullif(btrim(coalesce(v_cupon.codigo_cupon,'')), '') is null then
    raise exception using errcode='23514', message='CONVENIO_SIN_RESERVA_O_CODIGO';
  end if;

  select * into v_cita
  from public.citas_reservadas
  where reserva_id = v_cupon.reserva_id
  for update;

  if not found then
    raise exception using errcode='P0002', message='RESERVA_NO_EXISTE';
  end if;

  if v_cita.estado_ficha <> 'completa' or v_cita.cliente_id is null then
    raise exception using errcode='23514', message='CUPON_SIN_FICHA_COMPLETA';
  end if;

  if v_cita.canal not in ('cuponidad','bee') then
    raise exception using errcode='23514', message='RESERVA_NO_ES_CONVENIO';
  end if;

  v_proveedor := case
    when upper(coalesce(v_cupon.plataforma,'')) like '%CUPONIDAD%' then 'cuponidad'
    when upper(coalesce(v_cupon.plataforma,'')) like '%BEE%' then 'bee'
    else null
  end;

  if v_proveedor is distinct from v_cita.canal then
    raise exception using errcode='23514', message='CONVENIO_PLATAFORMA_NO_COINCIDE';
  end if;

  select * into v_beneficio
  from public.caja_convenio_beneficios
  where beneficio_code = btrim(p_beneficio_code)
    and activo is true;

  if not found or v_beneficio.proveedor is distinct from v_proveedor then
    raise exception using errcode='22023', message='BENEFICIO_CONVENIO_INVALIDO';
  end if;

  if v_beneficio.sede_restringida is not null
     and btrim(v_beneficio.sede_restringida) <> ''
     and btrim(v_beneficio.sede_restringida) is distinct from btrim(coalesce(v_cita.sede,'')) then
    raise exception using errcode='23514', message='BENEFICIO_SEDE_NO_COINCIDE';
  end if;

  select hora_apertura, hora_cierre
  into v_apertura, v_cierre
  from public.sedes
  where nombre = v_cita.sede and activo is true;

  if not found
     or v_cita.hora_cita < v_apertura
     or v_cita.hora_cita + make_interval(mins => v_beneficio.duracion_min) > v_cierre then
    raise exception using errcode='23514', message='HORARIO_NO_CABE_SERVICIO';
  end if;

  select * into v_mov
  from public.caja_movimientos
  where movimiento_id = v_cita.source_id
  for update;

  if not found or v_mov.source_id is distinct from v_cita.reserva_id then
    raise exception using errcode='23514', message='MOVIMIENTO_RESERVA_NO_COINCIDE';
  end if;

  update public.cupones_convenios
  set
    beneficio_code = v_beneficio.beneficio_code,
    sesiones_total = v_beneficio.sesiones_total,
    servicio = v_beneficio.nombre,
    responsable = btrim(p_responsable)
  where registro_id = v_cupon.registro_id;

  update public.citas_reservadas
  set
    service_code = null,
    servicio = v_beneficio.nombre,
    duracion = v_beneficio.duracion_min || ' min',
    duracion_min = v_beneficio.duracion_min,
    n_pax = 1,
    personas = 1,
    servicios_json = jsonb_build_array(jsonb_build_object(
      'codigo_convenio', v_beneficio.beneficio_code,
      'nombre', v_beneficio.nombre,
      'duracion_min', v_beneficio.duracion_min,
      'sesiones_total', v_beneficio.sesiones_total,
      'proveedor', v_beneficio.proveedor
    )),
    updated_at = now()
  where reserva_id = v_cita.reserva_id;

  update public.caja_movimientos
  set
    cliente_id = v_cita.cliente_id,
    cliente = v_cita.cliente,
    whatsapp = v_cita.whatsapp,
    n_pax = 1,
    servicio = v_beneficio.nombre,
    duracion = v_beneficio.duracion_min || ' min',
    estado = 'Cupón registrado',
    updated_at = now()
  where movimiento_id = v_mov.movimiento_id;

  delete from public.caja_atencion_detalle
  where movimiento_id = v_mov.movimiento_id;

  insert into public.caja_atencion_detalle (
    detalle_id, movimiento_id, fecha, sede, persona_n,
    terapista, servicio, duracion, monto_asignado, observacion
  ) values (
    v_cita.reserva_id || '-P1',
    v_mov.movimiento_id,
    v_cita.fecha_cita,
    v_cita.sede,
    1,
    'Por asignar',
    v_beneficio.nombre,
    v_beneficio.duracion_min || ' min',
    0,
    case
      when v_beneficio.sesiones_total > 1
        then v_beneficio.sesiones_total || ' sesiones del beneficio; control de consumo pendiente de implementación'
      else 'Beneficio de convenio asignado; cálculo económico pendiente de implementación'
    end
  );

  return jsonb_build_object(
    'ok', true,
    'registro_id', v_cupon.registro_id,
    'reserva_id', v_cita.reserva_id,
    'beneficio_code', v_beneficio.beneficio_code,
    'beneficio', v_beneficio.nombre,
    'duracion_min', v_beneficio.duracion_min,
    'sesiones_total', v_beneficio.sesiones_total,
    'economia_pendiente', true
  );
end;
$$;

revoke all on table public.caja_convenio_beneficios from public, anon, authenticated;
grant select on table public.caja_convenio_beneficios to service_role;

revoke all on function public.caja_asignar_beneficio_convenio_v1(text,text,text)
from public, anon, authenticated;
grant execute on function public.caja_asignar_beneficio_convenio_v1(text,text,text)
to service_role;

comment on table public.caja_convenio_beneficios is
  'Catálogo operativo de beneficios Cuponidad/Bee. No contiene ni calcula importes financieros.';
comment on function public.caja_asignar_beneficio_convenio_v1(text,text,text) is
  'Asigna beneficio, duración y sesiones a un cupón declarado sin validar ni calcular montos/coberturas.';

commit;

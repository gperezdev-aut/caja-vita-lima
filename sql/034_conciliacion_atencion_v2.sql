-- Caja Vita Lima — Conciliación final de atención V2
-- Migración 034
--
-- Alcance:
--   * extras/upselling auditables
--   * ajustes comerciales auditables
--   * coberturas que reducen saldo sin fingir caja recibida
--   * propinas separadas de los ingresos de Vita Lima
--   * compatibilidad no destructiva con el modelo legacy de propinas
--   * idempotencia server-only para el RPC V2
--
-- Esta migración NO reemplaza los RPC V1 y NO elimina histórico.

begin;

create table if not exists public.caja_atencion_extras (
  extra_id uuid primary key default extensions.gen_random_uuid(),
  movimiento_id text not null references public.caja_movimientos(movimiento_id) on delete restrict,
  tipo text not null check (tipo in ('MINUTOS_EXTRA','PRODUCTO','DECORACION','OTRO')),
  concepto text not null check (btrim(concepto) <> ''),
  cantidad numeric(12,2) not null default 1 check (cantidad > 0),
  monto_unitario numeric(12,2) not null check (monto_unitario >= 0),
  monto_total numeric(12,2) not null check (monto_total > 0),
  duracion_extra_min integer not null default 0 check (duracion_extra_min >= 0),
  persona_n integer check (persona_n is null or persona_n > 0),
  responsable text not null check (btrim(responsable) <> ''),
  request_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint caja_atencion_extras_total_check
    check (monto_total = round(cantidad * monto_unitario, 2))
);

create index if not exists idx_caja_atencion_extras_movimiento
  on public.caja_atencion_extras(movimiento_id);
create index if not exists idx_caja_atencion_extras_request
  on public.caja_atencion_extras(request_id);

create table if not exists public.caja_atencion_ajustes (
  ajuste_id uuid primary key default extensions.gen_random_uuid(),
  movimiento_id text not null references public.caja_movimientos(movimiento_id) on delete restrict,
  tipo text not null check (tipo in ('DESCUENTO','CORTESIA','AJUSTE_PRECIO')),
  monto numeric(12,2) not null check (monto > 0),
  motivo text not null check (btrim(motivo) <> ''),
  responsable text not null check (btrim(responsable) <> ''),
  request_id uuid not null,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_caja_atencion_ajustes_movimiento
  on public.caja_atencion_ajustes(movimiento_id);
create index if not exists idx_caja_atencion_ajustes_request
  on public.caja_atencion_ajustes(request_id);

create table if not exists public.caja_atencion_coberturas (
  cobertura_id uuid primary key default extensions.gen_random_uuid(),
  movimiento_id text not null references public.caja_movimientos(movimiento_id) on delete restrict,
  tipo text not null check (tipo in ('GIFT_CARD','CONVENIO_BEE','CONVENIO_CUPONIDAD','OTRA_COBERTURA')),
  referencia_id text,
  monto numeric(12,2) not null check (monto > 0),
  estado text not null default 'APLICADA' check (estado in ('APLICADA','REVERSADA')),
  responsable text not null check (btrim(responsable) <> ''),
  request_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  reversed_at timestamptz,
  reversed_by text,
  constraint caja_atencion_coberturas_referencia_check check (
    tipo = 'OTRA_COBERTURA' or btrim(coalesce(referencia_id, '')) <> ''
  ),
  constraint caja_atencion_coberturas_reversion_check check (
    (estado = 'APLICADA' and reversed_at is null and reversed_by is null)
    or
    (estado = 'REVERSADA' and reversed_at is not null and btrim(coalesce(reversed_by, '')) <> '')
  )
);

create index if not exists idx_caja_atencion_coberturas_movimiento
  on public.caja_atencion_coberturas(movimiento_id, estado);
create index if not exists idx_caja_atencion_coberturas_referencia
  on public.caja_atencion_coberturas(tipo, referencia_id);
create index if not exists idx_caja_atencion_coberturas_request
  on public.caja_atencion_coberturas(request_id);

-- Propinas: se conserva compatibilidad con el modelo legacy que ya usa
-- monto_total y fecha_operativa. V2 agrega monto/fecha/hora/método/estado,
-- pero ambos pares monto<->monto_total y fecha<->fecha_operativa quedan sincronizados.
create table if not exists public.caja_propinas (
  propina_id uuid primary key default extensions.gen_random_uuid(),
  movimiento_id text not null references public.caja_movimientos(movimiento_id) on delete restrict,
  monto_total numeric(12,2) not null,
  monto numeric(12,2) not null,
  fecha_operativa date not null,
  fecha date not null,
  hora time not null default ((clock_timestamp() at time zone 'America/Lima')::time),
  sede text not null check (btrim(sede) <> ''),
  metodo text not null default 'LEGACY',
  numero_operacion text,
  estado text not null default 'PENDIENTE',
  responsable text not null default 'LEGACY',
  request_id uuid not null default extensions.gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  anulada_en timestamptz,
  anulada_por text,
  motivo_anulacion text
);

alter table public.caja_propinas
  add column if not exists monto numeric(12,2),
  add column if not exists monto_total numeric(12,2),
  add column if not exists fecha date,
  add column if not exists fecha_operativa date,
  add column if not exists hora time,
  add column if not exists metodo text,
  add column if not exists numero_operacion text,
  add column if not exists estado text,
  add column if not exists responsable text,
  add column if not exists request_id uuid,
  add column if not exists updated_at timestamptz,
  add column if not exists anulada_en timestamptz,
  add column if not exists anulada_por text,
  add column if not exists motivo_anulacion text;

update public.caja_propinas
set monto = coalesce(monto, monto_total),
    monto_total = coalesce(monto_total, monto),
    fecha = coalesce(fecha, fecha_operativa, (created_at at time zone 'America/Lima')::date),
    fecha_operativa = coalesce(fecha_operativa, fecha, (created_at at time zone 'America/Lima')::date),
    hora = coalesce(hora, (created_at at time zone 'America/Lima')::time),
    metodo = coalesce(nullif(btrim(metodo), ''), 'LEGACY'),
    estado = coalesce(nullif(btrim(estado), ''), 'PENDIENTE'),
    responsable = coalesce(nullif(btrim(responsable), ''), 'LEGACY'),
    request_id = coalesce(request_id, extensions.gen_random_uuid()),
    updated_at = coalesce(updated_at, created_at, clock_timestamp());

alter table public.caja_propinas
  alter column monto set not null,
  alter column monto_total set not null,
  alter column fecha set not null,
  alter column fecha_operativa set not null,
  alter column hora set default ((clock_timestamp() at time zone 'America/Lima')::time),
  alter column hora set not null,
  alter column metodo set default 'LEGACY',
  alter column metodo set not null,
  alter column estado set default 'PENDIENTE',
  alter column estado set not null,
  alter column responsable set default 'LEGACY',
  alter column responsable set not null,
  alter column request_id set default extensions.gen_random_uuid(),
  alter column request_id set not null,
  alter column updated_at set default clock_timestamp(),
  alter column updated_at set not null;

-- El modelo legacy permitía solo una propina por movimiento. V2 es incremental,
-- por lo que una misma atención puede recibir otra propina en una conciliación posterior.
alter table public.caja_propinas
  drop constraint if exists caja_propinas_movimiento_unique;

create unique index if not exists uq_caja_propinas_request_id
  on public.caja_propinas(request_id);
create index if not exists idx_caja_propinas_movimiento
  on public.caja_propinas(movimiento_id);
create index if not exists idx_caja_propinas_fecha_sede
  on public.caja_propinas(fecha, sede);
create index if not exists idx_caja_propinas_estado
  on public.caja_propinas(estado);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='caja_propinas_monto_v2_check') then
    alter table public.caja_propinas
      add constraint caja_propinas_monto_v2_check
      check (monto > 0 and monto_total > 0 and monto = monto_total);
  end if;
  if not exists (select 1 from pg_constraint where conname='caja_propinas_estado_v2_check') then
    alter table public.caja_propinas
      add constraint caja_propinas_estado_v2_check
      check (estado in ('PENDIENTE','ENTREGADA','ANULADA'));
  end if;
  if not exists (select 1 from pg_constraint where conname='caja_propinas_responsable_v2_check') then
    alter table public.caja_propinas
      add constraint caja_propinas_responsable_v2_check
      check (btrim(responsable) <> '');
  end if;
  if not exists (select 1 from pg_constraint where conname='caja_propinas_operacion_v2_check') then
    alter table public.caja_propinas
      add constraint caja_propinas_operacion_v2_check check (
        upper(btrim(metodo)) in ('EFECTIVO','LEGACY')
        or btrim(coalesce(numero_operacion, '')) <> ''
      );
  end if;
  if not exists (select 1 from pg_constraint where conname='caja_propinas_anulacion_v2_check') then
    alter table public.caja_propinas
      add constraint caja_propinas_anulacion_v2_check check (
        (estado <> 'ANULADA' and anulada_en is null and anulada_por is null and motivo_anulacion is null)
        or
        (estado = 'ANULADA' and anulada_en is not null
         and btrim(coalesce(anulada_por, '')) <> ''
         and btrim(coalesce(motivo_anulacion, '')) <> '')
      );
  end if;
end $$;

create or replace function public.caja_sync_propina_compat_v2()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.monto is null and new.monto_total is null then
      raise exception using errcode='23514', message='PROPINA_MONTO_REQUERIDO';
    end if;
    if new.monto is not null and new.monto_total is not null and new.monto is distinct from new.monto_total then
      raise exception using errcode='23514', message='PROPINA_MONTO_INCONSISTENTE';
    end if;
    new.monto := coalesce(new.monto, new.monto_total);
    new.monto_total := new.monto;

    if new.fecha is null and new.fecha_operativa is null then
      new.fecha := (clock_timestamp() at time zone 'America/Lima')::date;
      new.fecha_operativa := new.fecha;
    elsif new.fecha is not null and new.fecha_operativa is not null and new.fecha is distinct from new.fecha_operativa then
      raise exception using errcode='23514', message='PROPINA_FECHA_INCONSISTENTE';
    else
      new.fecha := coalesce(new.fecha, new.fecha_operativa);
      new.fecha_operativa := new.fecha;
    end if;
  else
    if new.monto is distinct from old.monto and new.monto_total is not distinct from old.monto_total then
      new.monto_total := new.monto;
    elsif new.monto_total is distinct from old.monto_total and new.monto is not distinct from old.monto then
      new.monto := new.monto_total;
    elsif new.monto is distinct from old.monto and new.monto_total is distinct from old.monto_total
          and new.monto is distinct from new.monto_total then
      raise exception using errcode='23514', message='PROPINA_MONTO_INCONSISTENTE';
    end if;

    if new.fecha is distinct from old.fecha and new.fecha_operativa is not distinct from old.fecha_operativa then
      new.fecha_operativa := new.fecha;
    elsif new.fecha_operativa is distinct from old.fecha_operativa and new.fecha is not distinct from old.fecha then
      new.fecha := new.fecha_operativa;
    elsif new.fecha is distinct from old.fecha and new.fecha_operativa is distinct from old.fecha_operativa
          and new.fecha is distinct from new.fecha_operativa then
      raise exception using errcode='23514', message='PROPINA_FECHA_INCONSISTENTE';
    end if;
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists trg_caja_sync_propina_compat_v2 on public.caja_propinas;
create trigger trg_caja_sync_propina_compat_v2
before insert or update of monto, monto_total, fecha, fecha_operativa
on public.caja_propinas
for each row execute function public.caja_sync_propina_compat_v2();

-- Distribución: se conserva el nombre textual legacy y se agrega terapista_id.
-- V2 siempre envía el UUID; el trigger completa el nombre para mantener compatibilidad.
create table if not exists public.caja_propina_distribucion (
  distribucion_id uuid primary key default extensions.gen_random_uuid(),
  propina_id uuid not null references public.caja_propinas(propina_id) on delete restrict,
  terapista text not null,
  terapista_id uuid references public.terapistas(terapista_id) on delete restrict,
  monto numeric(12,2) not null check (monto > 0),
  estado text not null default 'PENDIENTE',
  entregado_en timestamptz,
  entregado_por text,
  created_at timestamptz not null default clock_timestamp()
);

alter table public.caja_propina_distribucion
  add column if not exists terapista text,
  add column if not exists terapista_id uuid,
  add column if not exists estado text,
  add column if not exists entregado_en timestamptz,
  add column if not exists entregado_por text;

update public.caja_propina_distribucion d
set terapista_id = coalesce(
      d.terapista_id,
      (select t.terapista_id from public.terapistas t where btrim(t.nombre)=btrim(d.terapista) limit 1),
      (select a.terapista_id from public.terapista_aliases a where btrim(a.alias)=btrim(d.terapista) limit 1)
    ),
    estado = coalesce(nullif(btrim(d.estado), ''), 'PENDIENTE');

alter table public.caja_propina_distribucion
  alter column terapista set not null,
  alter column estado set default 'PENDIENTE',
  alter column estado set not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='caja_propina_distribucion_terapista_fk_v2') then
    alter table public.caja_propina_distribucion
      add constraint caja_propina_distribucion_terapista_fk_v2
      foreign key (terapista_id) references public.terapistas(terapista_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname='caja_propina_distribucion_estado_v2_check') then
    alter table public.caja_propina_distribucion
      add constraint caja_propina_distribucion_estado_v2_check
      check (estado in ('PENDIENTE','ENTREGADA','ANULADA'));
  end if;
  if not exists (select 1 from pg_constraint where conname='caja_propina_distribucion_entrega_v2_check') then
    alter table public.caja_propina_distribucion
      add constraint caja_propina_distribucion_entrega_v2_check check (
        (estado = 'PENDIENTE' and entregado_en is null and entregado_por is null)
        or
        (estado = 'ENTREGADA' and entregado_en is not null and btrim(coalesce(entregado_por, '')) <> '')
        or
        (estado = 'ANULADA' and entregado_en is null)
      );
  end if;
end $$;

create unique index if not exists uq_caja_propina_distribucion_terapista_id
  on public.caja_propina_distribucion(propina_id, terapista_id)
  where terapista_id is not null;
create index if not exists idx_caja_propina_distribucion_terapista
  on public.caja_propina_distribucion(terapista_id, estado);

create or replace function public.caja_sync_propina_distribucion_compat_v2()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_nombre text;
  v_id uuid;
begin
  if new.terapista_id is not null then
    select nombre into v_nombre
    from public.terapistas
    where terapista_id=new.terapista_id;
    if v_nombre is null then
      raise exception using errcode='23514', message='PROPINA_TERAPISTA_NO_EXISTE';
    end if;
    new.terapista := v_nombre;
  elsif nullif(btrim(coalesce(new.terapista,'')), '') is not null then
    select t.terapista_id into v_id
    from public.terapistas t
    where btrim(t.nombre)=btrim(new.terapista)
    limit 1;
    if v_id is null then
      select a.terapista_id into v_id
      from public.terapista_aliases a
      where btrim(a.alias)=btrim(new.terapista)
      limit 1;
    end if;
    new.terapista_id := v_id;
  else
    raise exception using errcode='23514', message='PROPINA_TERAPISTA_REQUERIDA';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_caja_sync_propina_distribucion_compat_v2 on public.caja_propina_distribucion;
create trigger trg_caja_sync_propina_distribucion_compat_v2
before insert or update of terapista, terapista_id
on public.caja_propina_distribucion
for each row execute function public.caja_sync_propina_distribucion_compat_v2();

-- Reutilizamos los nombres legacy de validación para que los triggers existentes
-- sigan siendo válidos y ampliamos la distribución a hasta cinco personas.
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
  select coalesce(monto, monto_total)
    into v_monto_total
  from public.caja_propinas
  where propina_id = p_propina_id;

  if not found then return; end if;

  select count(*)::integer, coalesce(round(sum(monto),2),0)
    into v_cantidad, v_distribuido
  from public.caja_propina_distribucion
  where propina_id = p_propina_id;

  if v_cantidad < 1 or v_cantidad > 5 then
    raise exception using errcode='23514', message='La propina debe distribuirse entre una y cinco terapistas.';
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
  if tg_table_name = 'caja_propinas' then
    perform public.validar_distribucion_propina_v1(new.propina_id);
    return new;
  end if;
  if tg_op in ('UPDATE','DELETE') then
    perform public.validar_distribucion_propina_v1(old.propina_id);
  end if;
  if tg_op in ('INSERT','UPDATE') and (tg_op <> 'UPDATE' or new.propina_id is distinct from old.propina_id) then
    perform public.validar_distribucion_propina_v1(new.propina_id);
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_validar_propina_desde_distribucion on public.caja_propina_distribucion;
create constraint trigger trg_validar_propina_desde_distribucion
after insert or update or delete on public.caja_propina_distribucion
deferrable initially deferred
for each row execute function public.trigger_validar_distribucion_propina_v1();

drop trigger if exists trg_validar_propina_desde_cabecera on public.caja_propinas;
create constraint trigger trg_validar_propina_desde_cabecera
after insert or update of monto, monto_total on public.caja_propinas
deferrable initially deferred
for each row execute function public.trigger_validar_distribucion_propina_v1();

create table if not exists public.caja_conciliacion_atencion_requests (
  request_id uuid primary key,
  request_fingerprint text not null,
  movimiento_id text not null references public.caja_movimientos(movimiento_id) on delete restrict,
  reserva_id text references public.citas_reservadas(reserva_id) on delete restrict,
  respuesta jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_caja_conciliacion_requests_movimiento
  on public.caja_conciliacion_atencion_requests(movimiento_id);

alter table public.caja_atencion_extras enable row level security;
alter table public.caja_atencion_ajustes enable row level security;
alter table public.caja_atencion_coberturas enable row level security;
alter table public.caja_propinas enable row level security;
alter table public.caja_propina_distribucion enable row level security;
alter table public.caja_conciliacion_atencion_requests enable row level security;

revoke all on table
  public.caja_atencion_extras,
  public.caja_atencion_ajustes,
  public.caja_atencion_coberturas,
  public.caja_propinas,
  public.caja_propina_distribucion,
  public.caja_conciliacion_atencion_requests
from public, anon, authenticated;

grant select, insert, update on table
  public.caja_atencion_extras,
  public.caja_atencion_ajustes,
  public.caja_atencion_coberturas,
  public.caja_propinas,
  public.caja_propina_distribucion
  to service_role;

grant select, insert on table public.caja_conciliacion_atencion_requests to service_role;

comment on table public.caja_atencion_extras is
  'Upselling/extras de una atención; aumentan la venta de Vita Lima sin reescribir el servicio base.';
comment on table public.caja_atencion_ajustes is
  'Descuentos, cortesías y ajustes de precio auditables con motivo y responsable.';
comment on table public.caja_atencion_coberturas is
  'Coberturas que reducen el saldo del cliente sin representar necesariamente dinero recibido en caja.';
comment on table public.caja_propinas is
  'Dinero recibido por cuenta de terapistas; no forma parte de ventas ni utilidad de Vita Lima. Compatible con monto_total/fecha_operativa legacy.';
comment on table public.caja_propina_distribucion is
  'Distribución y entrega de propinas; conserva terapista textual legacy y agrega terapista_id del maestro vigente.';
comment on table public.caja_conciliacion_atencion_requests is
  'Idempotencia server-only para la conciliación final de atención V2.';

commit;

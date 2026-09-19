-- 042_cierre_caja_fisica_v3.sql
-- Caja Vita Lima — separación entre gastos y movimientos de fondos + cuadre físico real.
--
-- Principios:
-- 1) public.caja_salidas continúa representando GASTOS del negocio.
-- 2) retiros, entrega de propinas, transferencias y ajustes viven en
--    public.caja_movimientos_fondos y NO afectan el resultado financiero.
-- 3) no se hace backfill automático de metodo_salida: los históricos pueden
--    mezclar efectivo/digital y deben clasificarse de forma consciente.
-- 4) el cierre físico solo es calculable cuando todas las salidas del día/sede
--    tienen método conocido.

begin;

alter table public.caja_salidas
  add column if not exists metodo_salida text;

do $$ begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'caja_salidas_metodo_salida_check'
  ) then
    alter table public.caja_salidas
      add constraint caja_salidas_metodo_salida_check
      check (
        metodo_salida is null
        or metodo_salida in ('EFECTIVO', 'YAPE', 'PLIN', 'IZIPAY POS', 'BCP', 'OTRO')
      ) not valid;
  end if;
end $$;

create index if not exists idx_salidas_fecha_sede_metodo
  on public.caja_salidas(fecha, sede, metodo_salida);

create table if not exists public.caja_movimientos_fondos (
  movimiento_fondo_id text primary key,
  fecha date not null,
  hora time not null,
  sede text not null,
  tipo_movimiento text not null,
  metodo text not null,
  concepto text not null,
  monto numeric(12,2) not null default 0,
  responsable text,
  source_movimiento_id text,
  observacion text,
  created_at timestamptz not null default now(),
  constraint caja_movimientos_fondos_tipo_check
    check (tipo_movimiento in ('RETIRO_CAJA', 'ENTREGA_PROPINA', 'TRANSFERENCIA', 'AJUSTE_CAJA')),
  constraint caja_movimientos_fondos_metodo_check
    check (metodo in ('EFECTIVO', 'YAPE', 'PLIN', 'IZIPAY POS', 'BCP', 'OTRO')),
  constraint caja_movimientos_fondos_monto_nonnegative
    check (monto >= 0),
  constraint caja_movimientos_fondos_transferencia_no_efectivo
    check (tipo_movimiento <> 'TRANSFERENCIA' or metodo <> 'EFECTIVO'),
  constraint caja_movimientos_fondos_retiro_ajuste_efectivo
    check (
      tipo_movimiento not in ('RETIRO_CAJA', 'AJUSTE_CAJA')
      or metodo = 'EFECTIVO'
    )
);

create index if not exists idx_mov_fondos_fecha_sede
  on public.caja_movimientos_fondos(fecha, sede);
create index if not exists idx_mov_fondos_tipo
  on public.caja_movimientos_fondos(tipo_movimiento);
create index if not exists idx_mov_fondos_metodo
  on public.caja_movimientos_fondos(metodo);

alter table public.caja_movimientos_fondos enable row level security;
revoke all on table public.caja_movimientos_fondos from anon, authenticated;
grant select, insert, update, delete on table public.caja_movimientos_fondos to service_role;

alter table public.caja_cierres
  add column if not exists efectivo_vita_lima numeric(12,2) not null default 0,
  add column if not exists efectivo_propinas numeric(12,2) not null default 0,
  add column if not exists total_salidas_efectivo numeric(12,2) not null default 0,
  add column if not exists efectivo_a_retirar numeric(12,2) not null default 0,
  add column if not exists salidas_sin_metodo integer not null default 0,
  add column if not exists cierre_fisico_calculable boolean not null default false;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'caja_cierres_efectivo_vita_lima_nonnegative'
  ) then
    alter table public.caja_cierres
      add constraint caja_cierres_efectivo_vita_lima_nonnegative
      check (efectivo_vita_lima >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'caja_cierres_efectivo_propinas_nonnegative'
  ) then
    alter table public.caja_cierres
      add constraint caja_cierres_efectivo_propinas_nonnegative
      check (efectivo_propinas >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'caja_cierres_salidas_efectivo_nonnegative'
  ) then
    alter table public.caja_cierres
      add constraint caja_cierres_salidas_efectivo_nonnegative
      check (total_salidas_efectivo >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'caja_cierres_efectivo_a_retirar_nonnegative'
  ) then
    alter table public.caja_cierres
      add constraint caja_cierres_efectivo_a_retirar_nonnegative
      check (efectivo_a_retirar >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'caja_cierres_salidas_sin_metodo_nonnegative'
  ) then
    alter table public.caja_cierres
      add constraint caja_cierres_salidas_sin_metodo_nonnegative
      check (salidas_sin_metodo >= 0);
  end if;
end $$;

comment on column public.caja_salidas.metodo_salida is
  'Método con el que se pagó el gasto. NULL significa histórico pendiente de clasificación; no debe asumirse efectivo.';

comment on table public.caja_movimientos_fondos is
  'Movimientos de custodia/fondos que no son gasto del negocio: retiro de efectivo, entrega de propina, transferencia interna o ajuste de caja.';

comment on column public.caja_cierres.pozo_fondo is
  'Fondo de efectivo que queda en la sede para el siguiente día.';

comment on column public.caja_cierres.caja_esperada is
  'Efectivo físico esperado: caja_inicial + efectivo Vita Lima + efectivo de propinas - salidas que realmente afectaron efectivo.';

comment on column public.caja_cierres.diferencia is
  'Efectivo contado menos caja_esperada. Positivo=sobrante; negativo=faltante.';

comment on column public.caja_cierres.efectivo_a_retirar is
  'Efectivo contado menos fondo para el siguiente día, con mínimo cero.';

comment on column public.caja_cierres.cierre_fisico_calculable is
  'TRUE cuando las salidas de la fecha/sede tienen método suficiente para calcular caja física sin suposiciones.';

commit;

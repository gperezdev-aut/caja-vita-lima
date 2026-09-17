-- Caja Vita Lima — Cierre de caja con propinas separadas de ingresos
-- Migración 036. Aplicar después de 034/035.
-- No hace backfill histórico: cierres previos conservan 0 / {} en los nuevos campos.

begin;

alter table public.caja_cierres
  add column if not exists total_propinas numeric(12,2) not null default 0,
  add column if not exists total_procesado numeric(12,2) not null default 0,
  add column if not exists propinas_por_metodo jsonb not null default '{}'::jsonb,
  add column if not exists dinero_procesado_por_metodo jsonb not null default '{}'::jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='caja_cierres_total_propinas_nonnegative') then
    alter table public.caja_cierres
      add constraint caja_cierres_total_propinas_nonnegative check (total_propinas >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='caja_cierres_total_procesado_nonnegative') then
    alter table public.caja_cierres
      add constraint caja_cierres_total_procesado_nonnegative check (total_procesado >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='caja_cierres_procesado_consistente') then
    alter table public.caja_cierres
      add constraint caja_cierres_procesado_consistente
      check (total_procesado = round(coalesce(total_ingresos,0) + coalesce(total_propinas,0),2)) not valid;
  end if;
end $$;

comment on column public.caja_cierres.total_propinas is
  'Propinas recibidas en la fecha/sede del cierre. Dinero de terceros; no forma parte de total_ingresos.';
comment on column public.caja_cierres.total_procesado is
  'Dinero total procesado por medios de pago: ingresos Vita Lima + propinas no anuladas.';
comment on column public.caja_cierres.propinas_por_metodo is
  'Snapshot de propinas no anuladas por método al momento del cierre.';
comment on column public.caja_cierres.dinero_procesado_por_metodo is
  'Snapshot de todo el dinero procesado por método: caja_pagos + propinas no anuladas.';

commit;

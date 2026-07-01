-- ============================================================
-- Caja Vita Lima — Supabase SQL v5
-- Archivo: sql/005_dashboard_views.sql
-- Objetivo:
--   Crear vistas de dashboard y reportes básicos para revisar la
--   migración 1SEMESTRE2026 y futuras cargas históricas.
-- ============================================================

create or replace view public.vista_dashboard_resumen_general as
select
  (select count(*) from public.clientes) as total_clientes,
  (select count(*) from public.caja_movimientos) as total_movimientos,
  (select coalesce(sum(total_pagado), 0) from public.caja_movimientos) as total_ingresos_movimientos,
  (select count(*) from public.caja_pagos) as total_pagos,
  (select coalesce(sum(monto), 0) from public.caja_pagos) as total_ingresos_pagos,
  (select count(*) from public.caja_salidas) as total_salidas_registros,
  (select coalesce(sum(monto), 0) from public.caja_salidas) as total_salidas,
  (select count(*) from public.gift_cards) as total_gift_cards,
  (select coalesce(sum(monto), 0) from public.gift_cards) as total_gift_cards_monto,
  (select count(*) from public.cupones_convenios) as total_cupones_convenios,
  (select count(*) from public.migracion_revision where estado_revision = 'PENDIENTE') as total_revision_pendiente;

create or replace view public.vista_ingresos_por_metodo as
select
  metodo,
  count(*) as cantidad_pagos,
  coalesce(sum(monto), 0) as total
from public.caja_pagos
group by metodo
order by total desc;

create or replace view public.vista_ingresos_por_tipo_movimiento as
select
  tipo_movimiento,
  count(*) as cantidad_movimientos,
  coalesce(sum(total_pagado), 0) as total
from public.caja_movimientos
group by tipo_movimiento
order by total desc;

create or replace view public.vista_ingresos_por_fecha as
select
  fecha,
  sede,
  count(*) as cantidad_movimientos,
  coalesce(sum(total_pagado), 0) as total_pagado,
  coalesce(sum(pendiente), 0) as total_pendiente
from public.caja_movimientos
group by fecha, sede
order by fecha desc, sede;

create or replace view public.vista_ingresos_por_mes as
select
  date_trunc('month', fecha)::date as mes,
  sede,
  count(*) as cantidad_movimientos,
  coalesce(sum(total_pagado), 0) as total_pagado,
  coalesce(sum(pendiente), 0) as total_pendiente
from public.caja_movimientos
where fecha is not null
group by date_trunc('month', fecha)::date, sede
order by mes desc, sede;

create or replace view public.vista_salidas_por_tipo as
select
  tipo_gasto,
  count(*) as cantidad_salidas,
  coalesce(sum(monto), 0) as total
from public.caja_salidas
group by tipo_gasto
order by total desc;

create or replace view public.vista_salidas_por_fecha as
select
  fecha,
  sede,
  count(*) as cantidad_salidas,
  coalesce(sum(monto), 0) as total_salidas
from public.caja_salidas
group by fecha, sede
order by fecha desc, sede;

create or replace view public.vista_resultado_neto_por_mes as
with ingresos as (
  select
    date_trunc('month', fecha)::date as mes,
    sede,
    coalesce(sum(total_pagado), 0) as total_ingresos
  from public.caja_movimientos
  where fecha is not null
  group by date_trunc('month', fecha)::date, sede
),
salidas as (
  select
    date_trunc('month', fecha)::date as mes,
    sede,
    coalesce(sum(monto), 0) as total_salidas
  from public.caja_salidas
  where fecha is not null
  group by date_trunc('month', fecha)::date, sede
)
select
  coalesce(i.mes, s.mes) as mes,
  coalesce(i.sede, s.sede) as sede,
  coalesce(i.total_ingresos, 0) as total_ingresos,
  coalesce(s.total_salidas, 0) as total_salidas,
  coalesce(i.total_ingresos, 0) - coalesce(s.total_salidas, 0) as resultado_neto
from ingresos i
full outer join salidas s
  on s.mes = i.mes
 and s.sede = i.sede
order by mes desc, sede;

create or replace view public.vista_gift_cards_resumen as
select
  estado,
  count(*) as cantidad,
  coalesce(sum(monto), 0) as total_monto
from public.gift_cards
group by estado
order by total_monto desc;

create or replace view public.vista_cupones_convenios_resumen as
select
  plataforma,
  count(*) as cantidad,
  coalesce(sum(monto_reconocido), 0) as total_reconocido,
  coalesce(sum(monto_cobrado_tienda), 0) as total_cobrado_tienda
from public.cupones_convenios
group by plataforma
order by plataforma;

create or replace view public.vista_revision_pendiente_resumen as
select
  estado_revision,
  tipo_sugerido,
  count(*) as cantidad,
  coalesce(sum(monto_ingreso_detectado), 0) as ingreso_detectado,
  coalesce(sum(monto_salida_detectado), 0) as salida_detectada
from public.migracion_revision
where estado_revision = 'PENDIENTE'
group by estado_revision, tipo_sugerido
order by cantidad desc;

create or replace view public.vista_boletas_pendientes as
select
  movimiento_id,
  fecha,
  hora,
  sede,
  cliente,
  whatsapp,
  servicio,
  total_pagado,
  estado_boleta,
  numero_boleta,
  responsable,
  source_type,
  source_id,
  observacion
from public.caja_movimientos
where lower(coalesce(estado_boleta, '')) like '%pendiente%'
order by fecha desc, hora desc;

create or replace view public.vista_dashboard_operativo as
select
  m.movimiento_id,
  m.fecha,
  m.hora,
  m.sede,
  m.tipo_movimiento,
  m.estado,
  m.cliente,
  m.whatsapp,
  m.n_pax,
  m.servicio,
  m.duracion,
  m.total_pagado,
  m.pendiente,
  m.estado_boleta,
  m.numero_boleta,
  m.responsable,
  m.source_type,
  m.source_id
from public.caja_movimientos m
order by m.fecha desc, m.hora desc;

select 'vista_dashboard_resumen_general' as vista, count(*) as filas from public.vista_dashboard_resumen_general
union all
select 'vista_ingresos_por_metodo' as vista, count(*) as filas from public.vista_ingresos_por_metodo
union all
select 'vista_ingresos_por_tipo_movimiento' as vista, count(*) as filas from public.vista_ingresos_por_tipo_movimiento
union all
select 'vista_ingresos_por_mes' as vista, count(*) as filas from public.vista_ingresos_por_mes
union all
select 'vista_salidas_por_tipo' as vista, count(*) as filas from public.vista_salidas_por_tipo
union all
select 'vista_resultado_neto_por_mes' as vista, count(*) as filas from public.vista_resultado_neto_por_mes
union all
select 'vista_gift_cards_resumen' as vista, count(*) as filas from public.vista_gift_cards_resumen
union all
select 'vista_cupones_convenios_resumen' as vista, count(*) as filas from public.vista_cupones_convenios_resumen
union all
select 'vista_revision_pendiente_resumen' as vista, count(*) as filas from public.vista_revision_pendiente_resumen
union all
select 'vista_boletas_pendientes' as vista, count(*) as filas from public.vista_boletas_pendientes;

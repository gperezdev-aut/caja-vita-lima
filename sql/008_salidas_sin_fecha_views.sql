-- ============================================================
-- Caja Vita Lima — Supabase SQL v8
-- Archivo: sql/008_salidas_sin_fecha_views.sql
-- Objetivo:
--   Crear vistas para controlar salidas/gastos sin fecha.
--
-- Por qué existe:
--   En la migración de 1SEMESTRE2026 se detectaron salidas sin fecha.
--   Estas salidas no deben asignarse a un mes sin revisión, pero tampoco
--   deben desaparecer del control financiero.
-- ============================================================


-- ============================================================
-- 1) Vista: vista_salidas_sin_fecha
--
-- Lista detallada de salidas sin fecha.
-- ============================================================

create or replace view public.vista_salidas_sin_fecha as
select
  salida_id,
  fecha,
  hora,
  sede,
  tipo_gasto,
  concepto,
  monto,
  responsable,
  source_type,
  source_id,
  observacion,
  created_at
from public.caja_salidas
where fecha is null
order by monto desc, salida_id;


-- ============================================================
-- 2) Vista: vista_salidas_sin_fecha_resumen
--
-- Resume cuántas salidas sin fecha existen y cuánto suman.
-- ============================================================

create or replace view public.vista_salidas_sin_fecha_resumen as
select
  count(*) as total_salidas_sin_fecha,
  coalesce(sum(monto), 0) as total_monto_sin_fecha
from public.caja_salidas
where fecha is null;


-- ============================================================
-- 3) Vista: vista_salidas_sin_fecha_por_tipo
--
-- Resume salidas sin fecha por tipo de gasto.
-- ============================================================

create or replace view public.vista_salidas_sin_fecha_por_tipo as
select
  tipo_gasto,
  count(*) as cantidad,
  coalesce(sum(monto), 0) as total
from public.caja_salidas
where fecha is null
group by tipo_gasto
order by total desc;


-- ============================================================
-- 4) Vista: vista_reporte_socio_resumen_con_alertas
--
-- Resume lo cargado y agrega alerta de salidas sin fecha.
-- ============================================================

create or replace view public.vista_reporte_socio_resumen_con_alertas as
select
  r.*,
  s.total_salidas_sin_fecha as "Salidas sin fecha",
  s.total_monto_sin_fecha as "Monto salidas sin fecha",
  case
    when s.total_salidas_sin_fecha > 0 then
      'Hay salidas sin fecha pendientes de asignar a mes'
    else
      'Sin salidas sin fecha'
  end as "Alerta salidas sin fecha"
from public.vista_reporte_socio_mensual_resumen r
cross join public.vista_salidas_sin_fecha_resumen s;


-- ============================================================
-- 5) Validación rápida
-- ============================================================

select *
from public.vista_salidas_sin_fecha_resumen;

-- ============================================================
-- Caja Vita Lima — Supabase SQL v8.1 FIX
-- Archivo: sql/008_salidas_sin_fecha_views.sql
-- Objetivo:
--   Crear vistas para controlar salidas/gastos sin fecha.
--
-- FIX:
--   Se retiraron source_type y source_id de vista_salidas_sin_fecha
--   porque la tabla public.caja_salidas actual no tiene esas columnas.
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
  observacion,
  created_at
from public.caja_salidas
where fecha is null
order by monto desc, salida_id;

create or replace view public.vista_salidas_sin_fecha_resumen as
select
  count(*) as total_salidas_sin_fecha,
  coalesce(sum(monto), 0) as total_monto_sin_fecha
from public.caja_salidas
where fecha is null;

create or replace view public.vista_salidas_sin_fecha_por_tipo as
select
  tipo_gasto,
  count(*) as cantidad,
  coalesce(sum(monto), 0) as total
from public.caja_salidas
where fecha is null
group by tipo_gasto
order by total desc;

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

select *
from public.vista_salidas_sin_fecha_resumen;

-- ============================================================
-- Caja Vita Lima — Supabase SQL v7
-- Archivo: sql/007_reporte_socio_mensual.sql
-- Objetivo:
--   Crear una vista más amigable para socios / finanzas.
--
-- Esta vista oculta columnas técnicas y muestra solo lo útil:
--   - mes
--   - sede
--   - ingresos por servicios
--   - ingresos por gift cards
--   - préstamos de caja
--   - ingresos por cuponidad cobrados en caja
--   - total ingresos confirmados
--   - total salidas
--   - resultado neto confirmado
--   - pendientes de revisión
--
-- Base:
--   public.vista_reporte_financiero_mensual
-- ============================================================


-- ============================================================
-- 1) Vista: vista_reporte_socio_mensual
-- ============================================================

create or replace view public.vista_reporte_socio_mensual as
select
  mes,
  sede,

  ingresos_servicios as "Ingresos por servicios",
  ingresos_gift_cards as "Ingresos por Gift Cards",
  prestamos_caja as "Préstamos de caja",
  ingresos_cuponidad_en_caja as "Cuponidad cobrada en caja",

  total_ingresos_confirmados as "Total ingresos confirmados",
  total_salidas as "Total salidas",
  resultado_neto_confirmado as "Resultado neto confirmado",

  pendientes_revision as "Filas pendientes de revisión",
  monto_ingreso_pendiente_revision as "Ingreso pendiente por revisar",
  monto_salida_pendiente_revision as "Salida pendiente por revisar"

from public.vista_reporte_financiero_mensual
order by mes desc, sede;


-- ============================================================
-- 2) Vista: vista_reporte_socio_mensual_resumen
--
-- Versión con totales acumulados de todo lo cargado.
-- ============================================================

create or replace view public.vista_reporte_socio_mensual_resumen as
select
  count(*) as "Meses cargados",
  sum("Ingresos por servicios") as "Total servicios",
  sum("Ingresos por Gift Cards") as "Total Gift Cards",
  sum("Préstamos de caja") as "Total préstamos de caja",
  sum("Cuponidad cobrada en caja") as "Total Cuponidad en caja",
  sum("Total ingresos confirmados") as "Total ingresos confirmados",
  sum("Total salidas") as "Total salidas",
  sum("Resultado neto confirmado") as "Resultado neto confirmado",
  sum("Filas pendientes de revisión") as "Total filas pendientes",
  sum("Ingreso pendiente por revisar") as "Total ingreso pendiente por revisar",
  sum("Salida pendiente por revisar") as "Total salida pendiente por revisar"
from public.vista_reporte_socio_mensual;


-- ============================================================
-- 3) Vista: vista_reporte_socio_mes_actual
--
-- Muestra el último mes cargado.
-- Ojo: si el mes todavía no está cerrado, tomar como preliminar.
-- ============================================================

create or replace view public.vista_reporte_socio_mes_actual as
select *
from public.vista_reporte_socio_mensual
where mes = (
  select max(mes)
  from public.vista_reporte_socio_mensual
);


-- ============================================================
-- 4) Validación rápida
-- ============================================================

select *
from public.vista_reporte_socio_mensual;

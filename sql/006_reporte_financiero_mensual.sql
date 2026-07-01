-- ============================================================
-- Caja Vita Lima — Supabase SQL v6
-- Archivo: sql/006_reporte_financiero_mensual.sql
-- Objetivo:
--   Crear una vista financiera mensual más amigable para socios,
--   reportes y futura app web.
--
-- Base:
--   Usa datos ya migrados en:
--   - caja_movimientos
--   - caja_salidas
--   - cupones_convenios
--   - migracion_revision
--
-- Esta vista separa:
--   - ingresos por servicios normales
--   - ingresos por gift cards vendidas
--   - préstamos de caja
--   - cuponidad cobrada en tienda
--   - salidas
--   - resultado neto
--   - pendientes de revisión
-- ============================================================


-- ============================================================
-- 1) Vista: vista_reporte_financiero_mensual
-- ============================================================

create or replace view public.vista_reporte_financiero_mensual as
with movimientos as (
  select
    date_trunc('month', fecha)::date as mes,
    sede,

    sum(case
      when tipo_movimiento = 'ATENCION_HISTORICA'
      then coalesce(total_pagado, 0)
      else 0
    end) as ingresos_servicios,

    sum(case
      when tipo_movimiento = 'GIFT_CARD_VENTA'
      then coalesce(total_pagado, 0)
      else 0
    end) as ingresos_gift_cards,

    sum(case
      when tipo_movimiento = 'PRESTAMO_CAJA_INGRESO'
      then coalesce(total_pagado, 0)
      else 0
    end) as prestamos_caja,

    sum(case
      when tipo_movimiento = 'CUPONIDAD'
      then coalesce(total_pagado, 0)
      else 0
    end) as ingresos_cuponidad_en_caja,

    sum(case
      when tipo_movimiento not in (
        'ATENCION_HISTORICA',
        'GIFT_CARD_VENTA',
        'PRESTAMO_CAJA_INGRESO',
        'CUPONIDAD'
      )
      then coalesce(total_pagado, 0)
      else 0
    end) as otros_ingresos,

    sum(coalesce(total_pagado, 0)) as total_ingresos_confirmados,
    count(*) as total_movimientos

  from public.caja_movimientos
  where fecha is not null
  group by date_trunc('month', fecha)::date, sede
),

salidas as (
  select
    date_trunc('month', fecha)::date as mes,
    sede,
    sum(coalesce(monto, 0)) as total_salidas,
    count(*) as total_salidas_registros
  from public.caja_salidas
  where fecha is not null
  group by date_trunc('month', fecha)::date, sede
),

cupones as (
  select
    date_trunc('month', fecha)::date as mes,
    sede,
    sum(case
      when plataforma = 'Bee Beneficios'
      then coalesce(monto_reconocido, 0)
      else 0
    end) as bee_monto_reconocido,

    sum(case
      when plataforma = 'Bee Beneficios'
      then coalesce(monto_cobrado_tienda, 0)
      else 0
    end) as bee_cobrado_tienda,

    sum(case
      when plataforma = 'Cuponidad'
      then coalesce(monto_reconocido, 0)
      else 0
    end) as cuponidad_monto_reconocido,

    sum(case
      when plataforma = 'Cuponidad'
      then coalesce(monto_cobrado_tienda, 0)
      else 0
    end) as cuponidad_cobrado_tienda,

    count(*) as total_cupones_convenios

  from public.cupones_convenios
  where fecha is not null
  group by date_trunc('month', fecha)::date, sede
),

revision as (
  select
    date_trunc(
      'month',
      case
        when fecha_original ~ '^\d{4}-\d{2}-\d{2}$'
        then fecha_original::date
        else null
      end
    )::date as mes,
    'Miraflores'::text as sede,
    count(*) as pendientes_revision,
    sum(coalesce(monto_ingreso_detectado, 0)) as monto_ingreso_pendiente_revision,
    sum(coalesce(monto_salida_detectado, 0)) as monto_salida_pendiente_revision
  from public.migracion_revision
  where estado_revision = 'PENDIENTE'
    and fecha_original ~ '^\d{4}-\d{2}-\d{2}$'
  group by date_trunc('month', fecha_original::date)::date
),

base_meses as (
  select mes, sede from movimientos
  union
  select mes, sede from salidas
  union
  select mes, sede from cupones
  union
  select mes, sede from revision
)

select
  b.mes,
  b.sede,

  coalesce(m.ingresos_servicios, 0) as ingresos_servicios,
  coalesce(m.ingresos_gift_cards, 0) as ingresos_gift_cards,
  coalesce(m.prestamos_caja, 0) as prestamos_caja,
  coalesce(m.ingresos_cuponidad_en_caja, 0) as ingresos_cuponidad_en_caja,
  coalesce(m.otros_ingresos, 0) as otros_ingresos,
  coalesce(m.total_ingresos_confirmados, 0) as total_ingresos_confirmados,

  coalesce(s.total_salidas, 0) as total_salidas,

  coalesce(m.total_ingresos_confirmados, 0)
    - coalesce(s.total_salidas, 0) as resultado_neto_confirmado,

  coalesce(c.bee_monto_reconocido, 0) as bee_monto_reconocido,
  coalesce(c.bee_cobrado_tienda, 0) as bee_cobrado_tienda,
  coalesce(c.cuponidad_monto_reconocido, 0) as cuponidad_monto_reconocido,
  coalesce(c.cuponidad_cobrado_tienda, 0) as cuponidad_cobrado_tienda,
  coalesce(c.total_cupones_convenios, 0) as total_cupones_convenios,

  coalesce(r.pendientes_revision, 0) as pendientes_revision,
  coalesce(r.monto_ingreso_pendiente_revision, 0) as monto_ingreso_pendiente_revision,
  coalesce(r.monto_salida_pendiente_revision, 0) as monto_salida_pendiente_revision,

  coalesce(m.total_movimientos, 0) as total_movimientos,
  coalesce(s.total_salidas_registros, 0) as total_salidas_registros

from base_meses b
left join movimientos m
  on m.mes = b.mes
 and m.sede = b.sede
left join salidas s
  on s.mes = b.mes
 and s.sede = b.sede
left join cupones c
  on c.mes = b.mes
 and c.sede = b.sede
left join revision r
  on r.mes = b.mes
 and r.sede = b.sede
order by b.mes desc, b.sede;


-- ============================================================
-- 2) Vista: vista_reporte_financiero_mensual_simple
--
-- Versión reducida para lectura rápida.
-- ============================================================

create or replace view public.vista_reporte_financiero_mensual_simple as
select
  mes,
  sede,
  ingresos_servicios,
  ingresos_gift_cards,
  prestamos_caja,
  total_ingresos_confirmados,
  total_salidas,
  resultado_neto_confirmado,
  pendientes_revision
from public.vista_reporte_financiero_mensual
order by mes desc, sede;


-- ============================================================
-- 3) Validación rápida
-- ============================================================

select *
from public.vista_reporte_financiero_mensual
order by mes desc, sede;

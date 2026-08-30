-- ============================================================
-- Caja Vita Lima — Supabase SQL v11
-- Archivo: sql/011_fix_reporte_financiero.sql
-- Objetivo:
--   Corregir dos problemas detectados en la auditoría de código
--   sobre sql/006_reporte_financiero_mensual.sql y
--   sql/007_reporte_socio_mensual.sql. Se crea como migración nueva
--   (no se editan los archivos 006/007) para conservar el historial.
--
-- CORRECCIÓN (a) — Sede hardcodeada en pendientes de revisión:
--   El CTE "revision" de vista_reporte_financiero_mensual asignaba
--   'Miraflores'::text como sede fija para TODAS las filas de
--   public.migracion_revision, sin importar la sede real de cada
--   registro migrado.
--
--   Se revisó sql/001_create_tables.sql y sql/004_migration_review_tables.sql:
--   la tabla public.migracion_revision NO tiene ninguna columna de sede
--   (ni "sede" ni "sede_original"). Por lo tanto NO es posible agrupar
--   estos pendientes por su sede real con los datos actuales, y esta
--   migración NO inventa una columna nueva para no fabricar un dato que
--   no existe en el origen.
--
--   En su lugar, se deja de asignar falsamente 'Miraflores' (que
--   distorsionaba el reporte de esa sede) y se etiquetan estas filas
--   como 'SIN_SEDE' en un registro aparte por mes, dejando explícito que
--   son pendientes de revisión sin sede conocida. Ver nota para Gerald
--   en la descripción del Pull Request: hay que decidir si conviene
--   agregar una columna de sede en el origen de la migración
--   (archivo_origen / hoja_origen ya existen y podrían usarse para
--   inferirla, pero eso requeriría lógica adicional de mapeo que no se
--   aplicó aquí para no adivinar datos).
--
-- CORRECCIÓN (b) — Resultado neto mezclado con préstamos de caja:
--   total_ingresos_confirmados (y por lo tanto resultado_neto_confirmado)
--   incluye "prestamos_caja", que son préstamos hacia la caja y no un
--   ingreso operativo real. Se agrega una columna nueva
--   "resultado_neto_operativo" = total_ingresos_confirmados -
--   prestamos_caja - total_salidas, en vista_reporte_financiero_mensual,
--   vista_reporte_financiero_mensual_simple y vista_reporte_socio_mensual
--   (como "Resultado neto operativo (sin préstamos)"). No se borra
--   resultado_neto_confirmado: ambos números coexisten para que socios
--   y reportes puedan comparar.
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

-- migracion_revision no tiene columna de sede (ver nota al inicio del
-- archivo): las filas pendientes ya no se asignan a 'Miraflores' de
-- forma fija, sino a la sede-pseudo 'SIN_SEDE'.
revision_limpia as (
  select
    case
      when fecha_original ~ '^\d{4}-\d{2}-\d{2}$'
      then fecha_original::date
      else null
    end as fecha_revision,
    coalesce(monto_ingreso_detectado, 0) as monto_ingreso_detectado,
    coalesce(monto_salida_detectado, 0) as monto_salida_detectado
  from public.migracion_revision
  where estado_revision = 'PENDIENTE'
),

revision as (
  select
    date_trunc('month', fecha_revision)::date as mes,
    'SIN_SEDE'::text as sede,
    count(*) as pendientes_revision,
    sum(monto_ingreso_detectado) as monto_ingreso_pendiente_revision,
    sum(monto_salida_detectado) as monto_salida_pendiente_revision
  from revision_limpia
  where fecha_revision is not null
  group by date_trunc('month', fecha_revision)::date
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
  coalesce(s.total_salidas_registros, 0) as total_salidas_registros,

  -- (b) resultado operativo real, sin préstamos de caja mezclados.
  coalesce(m.total_ingresos_confirmados, 0)
    - coalesce(m.prestamos_caja, 0)
    - coalesce(s.total_salidas, 0) as resultado_neto_operativo

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
  pendientes_revision,
  resultado_neto_operativo
from public.vista_reporte_financiero_mensual
order by mes desc, sede;


-- ============================================================
-- 3) Vista: vista_reporte_socio_mensual
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
  monto_salida_pendiente_revision as "Salida pendiente por revisar",

  resultado_neto_operativo as "Resultado neto operativo (sin préstamos)"

from public.vista_reporte_financiero_mensual
order by mes desc, sede;


-- ============================================================
-- 4) Validación rápida
-- ============================================================

select *
from public.vista_reporte_financiero_mensual
order by mes desc, sede;

select *
from public.vista_reporte_socio_mensual;

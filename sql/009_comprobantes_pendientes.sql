-- ============================================================
-- Caja Vita Lima — Supabase SQL v9
-- Archivo: sql/009_comprobantes_pendientes.sql
-- Objetivo:
--   Crear vistas para controlar boletas, facturas y comprobantes
--   pendientes o incompletos.
--
-- Por qué existe:
--   En la migración histórica pueden existir movimientos con:
--   - estado de boleta pendiente
--   - estado vacío
--   - número de boleta vacío
--   - estado OK pero sin número
--   - comprobantes observados
--
-- Nota:
--   La tabla actual public.caja_movimientos tiene:
--   estado_boleta
--   numero_boleta
--
--   Todavía no tiene una columna separada tipo_comprobante.
--   Por eso esta versión trabaja con los campos actuales.
-- ============================================================


-- ============================================================
-- 1) Vista: vista_comprobantes_estado_general
--
-- Clasifica todos los movimientos según su estado de comprobante.
-- ============================================================

create or replace view public.vista_comprobantes_estado_general as
with base as (
  select
    movimiento_id,
    fecha,
    hora,
    sede,
    tipo_movimiento,
    estado,
    cliente,
    whatsapp,
    servicio,
    total_pagado,
    estado_boleta,
    numero_boleta,
    responsable,
    source_type,
    source_id,
    observacion,

    nullif(trim(coalesce(estado_boleta, '')), '') as estado_boleta_limpio,
    nullif(trim(coalesce(numero_boleta, '')), '') as numero_boleta_limpio

  from public.caja_movimientos
)
select
  movimiento_id,
  fecha,
  hora,
  sede,
  tipo_movimiento,
  estado,
  cliente,
  whatsapp,
  servicio,
  total_pagado,
  estado_boleta,
  numero_boleta,
  responsable,
  source_type,
  source_id,
  observacion,

  case
    when tipo_movimiento in ('PRESTAMO_CAJA_INGRESO', 'DEVOLUCION_PRESTAMO_CAJA') then
      'NO_APLICA_PRESTAMO'

    when estado_boleta_limpio is null
     and numero_boleta_limpio is null then
      'SIN_ESTADO_Y_SIN_NUMERO'

    when estado_boleta_limpio is null
     and numero_boleta_limpio is not null then
      'SIN_ESTADO_CON_NUMERO'

    when lower(estado_boleta_limpio) like '%pend%' then
      'COMPROBANTE_PENDIENTE'

    when lower(estado_boleta_limpio) like '%anul%' then
      'COMPROBANTE_ANULADO_REVISION'

    when lower(estado_boleta_limpio) in ('ok', 'emitida', 'emitido', 'boleta', 'factura')
     and numero_boleta_limpio is null then
      'OK_SIN_NUMERO'

    when numero_boleta_limpio is null then
      'SIN_NUMERO_COMPROBANTE'

    else
      'OK_CON_NUMERO'
  end as estado_comprobante_calculado,

  case
    when tipo_movimiento in ('PRESTAMO_CAJA_INGRESO', 'DEVOLUCION_PRESTAMO_CAJA') then
      false
    else
      true
  end as requiere_comprobante

from base;


-- ============================================================
-- 2) Vista: vista_comprobantes_pendientes
--
-- Lista solo movimientos que requieren revisión de comprobante.
-- ============================================================

create or replace view public.vista_comprobantes_pendientes as
select
  movimiento_id,
  fecha,
  hora,
  sede,
  tipo_movimiento,
  cliente,
  whatsapp,
  servicio,
  total_pagado,
  estado_boleta,
  numero_boleta,
  estado_comprobante_calculado,
  responsable,
  source_type,
  source_id,
  observacion
from public.vista_comprobantes_estado_general
where requiere_comprobante = true
  and estado_comprobante_calculado not in (
    'OK_CON_NUMERO'
  )
order by fecha desc nulls last, hora desc nulls last, total_pagado desc;


-- ============================================================
-- 3) Vista: vista_comprobantes_resumen
--
-- Resume comprobantes por estado calculado.
-- ============================================================

create or replace view public.vista_comprobantes_resumen as
select
  estado_comprobante_calculado,
  count(*) as cantidad,
  coalesce(sum(total_pagado), 0) as total_importe
from public.vista_comprobantes_estado_general
where requiere_comprobante = true
group by estado_comprobante_calculado
order by cantidad desc;


-- ============================================================
-- 4) Vista: vista_comprobantes_sin_numero
--
-- Lista comprobantes que no tienen número registrado.
-- ============================================================

create or replace view public.vista_comprobantes_sin_numero as
select
  movimiento_id,
  fecha,
  hora,
  sede,
  tipo_movimiento,
  cliente,
  whatsapp,
  servicio,
  total_pagado,
  estado_boleta,
  numero_boleta,
  estado_comprobante_calculado,
  responsable,
  source_type,
  source_id,
  observacion
from public.vista_comprobantes_estado_general
where requiere_comprobante = true
  and (
    numero_boleta is null
    or trim(coalesce(numero_boleta, '')) = ''
  )
order by fecha desc nulls last, hora desc nulls last, total_pagado desc;


-- ============================================================
-- 5) Vista: vista_comprobantes_valores_origen
--
-- Muestra los valores originales encontrados en estado_boleta.
-- Sirve para mejorar reglas después.
-- ============================================================

create or replace view public.vista_comprobantes_valores_origen as
select
  coalesce(nullif(trim(estado_boleta), ''), 'SIN_ESTADO') as estado_boleta_origen,
  count(*) as cantidad,
  coalesce(sum(total_pagado), 0) as total_importe
from public.caja_movimientos
where tipo_movimiento not in ('PRESTAMO_CAJA_INGRESO', 'DEVOLUCION_PRESTAMO_CAJA')
group by coalesce(nullif(trim(estado_boleta), ''), 'SIN_ESTADO')
order by cantidad desc;


-- ============================================================
-- 6) Vista: vista_reporte_socio_alertas_comprobantes
--
-- Resumen para socio con alertas de comprobantes.
-- ============================================================

create or replace view public.vista_reporte_socio_alertas_comprobantes as
select
  count(*) filter (
    where estado_comprobante_calculado = 'COMPROBANTE_PENDIENTE'
  ) as comprobantes_pendientes,

  count(*) filter (
    where estado_comprobante_calculado in (
      'SIN_ESTADO_Y_SIN_NUMERO',
      'SIN_ESTADO_CON_NUMERO',
      'SIN_NUMERO_COMPROBANTE',
      'OK_SIN_NUMERO'
    )
  ) as comprobantes_sin_numero_o_incompletos,

  count(*) filter (
    where estado_comprobante_calculado = 'OK_CON_NUMERO'
  ) as comprobantes_ok,

  count(*) filter (
    where estado_comprobante_calculado = 'COMPROBANTE_ANULADO_REVISION'
  ) as comprobantes_anulados_revision,

  coalesce(sum(total_pagado) filter (
    where estado_comprobante_calculado = 'COMPROBANTE_PENDIENTE'
  ), 0) as monto_comprobantes_pendientes,

  coalesce(sum(total_pagado) filter (
    where estado_comprobante_calculado in (
      'SIN_ESTADO_Y_SIN_NUMERO',
      'SIN_ESTADO_CON_NUMERO',
      'SIN_NUMERO_COMPROBANTE',
      'OK_SIN_NUMERO'
    )
  ), 0) as monto_comprobantes_sin_numero_o_incompletos

from public.vista_comprobantes_estado_general
where requiere_comprobante = true;


-- ============================================================
-- 7) Vista: vista_reporte_socio_resumen_con_alertas_v2
--
-- Une:
-- - resumen financiero
-- - alerta salidas sin fecha
-- - alerta comprobantes
-- ============================================================

create or replace view public.vista_reporte_socio_resumen_con_alertas_v2 as
select
  r.*,
  c.comprobantes_pendientes as "Comprobantes pendientes",
  c.comprobantes_sin_numero_o_incompletos as "Comprobantes sin número o incompletos",
  c.comprobantes_ok as "Comprobantes OK",
  c.comprobantes_anulados_revision as "Comprobantes anulados por revisar",
  c.monto_comprobantes_pendientes as "Monto comprobantes pendientes",
  c.monto_comprobantes_sin_numero_o_incompletos as "Monto comprobantes sin número o incompletos",
  case
    when c.comprobantes_pendientes > 0
      or c.comprobantes_sin_numero_o_incompletos > 0
      or c.comprobantes_anulados_revision > 0
    then 'Hay comprobantes pendientes o incompletos por revisar'
    else 'Comprobantes sin alertas'
  end as "Alerta comprobantes"
from public.vista_reporte_socio_resumen_con_alertas r
cross join public.vista_reporte_socio_alertas_comprobantes c;


-- ============================================================
-- 8) Validación rápida
-- ============================================================

select *
from public.vista_comprobantes_resumen;

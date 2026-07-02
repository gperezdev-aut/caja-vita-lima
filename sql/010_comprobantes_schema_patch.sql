-- ============================================================
-- Caja Vita Lima — Supabase SQL v10
-- Archivo: sql/010_comprobantes_schema_patch.sql
-- Objetivo:
--   Preparar la tabla caja_movimientos para manejar boletas,
--   facturas y comprobantes de forma editable desde la futura app.
--
-- Este SQL NO borra datos.
-- Solo agrega columnas nuevas y crea vistas de control.
-- ============================================================

alter table public.caja_movimientos
add column if not exists tipo_comprobante text;

alter table public.caja_movimientos
add column if not exists estado_comprobante_manual text;

alter table public.caja_movimientos
add column if not exists numero_comprobante_final text;

alter table public.caja_movimientos
add column if not exists fecha_emision_comprobante date;

alter table public.caja_movimientos
add column if not exists observacion_comprobante text;

alter table public.caja_movimientos
add column if not exists comprobante_revisado_por text;

alter table public.caja_movimientos
add column if not exists comprobante_revisado_at timestamptz;

update public.caja_movimientos
set
  numero_comprobante_final = coalesce(
    nullif(trim(numero_comprobante_final), ''),
    nullif(trim(numero_boleta), '')
  )
where numero_comprobante_final is null
   or trim(coalesce(numero_comprobante_final, '')) = '';

update public.caja_movimientos
set
  tipo_comprobante = case
    when tipo_movimiento in ('PRESTAMO_CAJA_INGRESO', 'DEVOLUCION_PRESTAMO_CAJA') then 'NO_APLICA'
    when lower(coalesce(estado_boleta, '')) like '%fact%' then 'FACTURA'
    when lower(coalesce(estado_boleta, '')) like '%bolet%' then 'BOLETA'
    when nullif(trim(coalesce(numero_boleta, '')), '') is not null then 'BOLETA'
    else 'POR_DEFINIR'
  end
where tipo_comprobante is null
   or trim(coalesce(tipo_comprobante, '')) = '';

update public.caja_movimientos
set
  estado_comprobante_manual = case
    when tipo_movimiento in ('PRESTAMO_CAJA_INGRESO', 'DEVOLUCION_PRESTAMO_CAJA') then 'NO_APLICA'
    when lower(coalesce(estado_boleta, '')) like '%pend%' then 'PENDIENTE'
    when lower(coalesce(estado_boleta, '')) like '%anul%' then 'OBSERVAR'
    when nullif(trim(coalesce(numero_boleta, '')), '') is not null then 'OK'
    when lower(coalesce(estado_boleta, '')) in ('ok', 'emitida', 'emitido', 'boleta', 'factura') then 'OBSERVAR'
    else 'PENDIENTE'
  end
where estado_comprobante_manual is null
   or trim(coalesce(estado_comprobante_manual, '')) = '';

create or replace view public.vista_comprobantes_control_editable as
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

  estado_boleta as estado_boleta_origen,
  numero_boleta as numero_boleta_origen,

  tipo_comprobante,
  estado_comprobante_manual,
  numero_comprobante_final,
  fecha_emision_comprobante,
  observacion_comprobante,
  comprobante_revisado_por,
  comprobante_revisado_at,

  case
    when tipo_comprobante = 'NO_APLICA'
      or estado_comprobante_manual = 'NO_APLICA' then 'NO_APLICA'

    when estado_comprobante_manual = 'OK'
      and nullif(trim(coalesce(numero_comprobante_final, '')), '') is not null then 'OK_COMPLETO'

    when estado_comprobante_manual = 'OK'
      and nullif(trim(coalesce(numero_comprobante_final, '')), '') is null then 'OK_SIN_NUMERO'

    when estado_comprobante_manual = 'PENDIENTE' then 'PENDIENTE'

    when estado_comprobante_manual = 'OBSERVAR' then 'OBSERVAR'

    when nullif(trim(coalesce(numero_comprobante_final, '')), '') is null then 'SIN_NUMERO'

    else 'REVISAR'
  end as estado_comprobante_final_calculado,

  source_type,
  source_id,
  observacion

from public.caja_movimientos
order by fecha desc nulls last, hora desc nulls last;

create or replace view public.vista_comprobantes_control_resumen as
select
  estado_comprobante_final_calculado,
  tipo_comprobante,
  estado_comprobante_manual,
  count(*) as cantidad,
  coalesce(sum(total_pagado), 0) as total_importe
from public.vista_comprobantes_control_editable
where estado_comprobante_final_calculado <> 'NO_APLICA'
group by
  estado_comprobante_final_calculado,
  tipo_comprobante,
  estado_comprobante_manual
order by cantidad desc;

create or replace view public.vista_comprobantes_para_revisar as
select *
from public.vista_comprobantes_control_editable
where estado_comprobante_final_calculado in (
  'PENDIENTE',
  'OBSERVAR',
  'OK_SIN_NUMERO',
  'SIN_NUMERO',
  'REVISAR'
)
order by fecha desc nulls last, hora desc nulls last, total_pagado desc;

create or replace view public.vista_reporte_socio_resumen_con_alertas_v3 as
with comp as (
  select
    count(*) filter (
      where estado_comprobante_final_calculado in ('PENDIENTE', 'OBSERVAR', 'OK_SIN_NUMERO', 'SIN_NUMERO', 'REVISAR')
    ) as comprobantes_para_revisar,

    coalesce(sum(total_pagado) filter (
      where estado_comprobante_final_calculado in ('PENDIENTE', 'OBSERVAR', 'OK_SIN_NUMERO', 'SIN_NUMERO', 'REVISAR')
    ), 0) as monto_comprobantes_para_revisar,

    count(*) filter (
      where estado_comprobante_final_calculado = 'OK_COMPLETO'
    ) as comprobantes_ok_completos,

    count(*) filter (
      where estado_comprobante_final_calculado = 'NO_APLICA'
    ) as comprobantes_no_aplica

  from public.vista_comprobantes_control_editable
)
select
  r.*,
  comp.comprobantes_para_revisar as "Comprobantes para revisar",
  comp.monto_comprobantes_para_revisar as "Monto comprobantes para revisar",
  comp.comprobantes_ok_completos as "Comprobantes OK completos",
  comp.comprobantes_no_aplica as "Comprobantes no aplica",
  case
    when comp.comprobantes_para_revisar > 0 then
      'Hay comprobantes pendientes/incompletos para revisar'
    else
      'Comprobantes sin alertas'
  end as "Alerta comprobantes editable"
from public.vista_reporte_socio_resumen_con_alertas r
cross join comp;

select *
from public.vista_comprobantes_control_resumen;

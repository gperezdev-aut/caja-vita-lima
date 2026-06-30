-- ============================================================
-- Caja Vita Lima — Supabase SQL v3
-- Archivo: sql/003_validation_queries.sql
-- Objetivo:
--   Consultas de validación para revisar estructura, conteos y datos
--   base de la nueva Caja Vita Lima en Supabase.
--
-- Uso:
--   Ejecutar estas consultas después de crear tablas, cargar seed inicial
--   o importar datos desde Excel / CSV.
-- ============================================================


-- ============================================================
-- 1) Conteo general de tablas principales
-- ============================================================

select 'config_listas' as tabla, count(*) as total from public.config_listas
union all
select 'usuarios' as tabla, count(*) as total from public.usuarios
union all
select 'clientes' as tabla, count(*) as total from public.clientes
union all
select 'citas_reservadas' as tabla, count(*) as total from public.citas_reservadas
union all
select 'caja_movimientos' as tabla, count(*) as total from public.caja_movimientos
union all
select 'caja_pagos' as tabla, count(*) as total from public.caja_pagos
union all
select 'caja_atencion_detalle' as tabla, count(*) as total from public.caja_atencion_detalle
union all
select 'gift_cards' as tabla, count(*) as total from public.gift_cards
union all
select 'cupones_convenios' as tabla, count(*) as total from public.cupones_convenios
union all
select 'caja_salidas' as tabla, count(*) as total from public.caja_salidas
union all
select 'caja_cierres' as tabla, count(*) as total from public.caja_cierres;


-- ============================================================
-- 2) Validar configuración base
-- ============================================================

select
  lista,
  count(*) as total_items
from public.config_listas
group by lista
order by lista;


-- ============================================================
-- 3) Ver sedes activas
-- ============================================================

select
  valor as sede,
  orden,
  activo
from public.config_listas
where lista = 'SEDES'
order by orden;


-- ============================================================
-- 4) Ver métodos de pago activos
-- ============================================================

select
  valor as metodo_pago,
  orden,
  activo
from public.config_listas
where lista = 'METODOS_PAGO'
order by orden;


-- ============================================================
-- 5) Ver terapistas activas
-- ============================================================

select
  valor as terapista,
  orden,
  activo
from public.config_listas
where lista = 'TERAPISTAS'
order by orden;


-- ============================================================
-- 6) Ver usuarios iniciales
-- Nota: los PINs son temporales y deben cambiarse antes de producción.
-- ============================================================

select
  usuario,
  rol,
  nombre,
  activo,
  nota
from public.usuarios
order by usuario;


-- ============================================================
-- 7) Validar clientes duplicados por WhatsApp
-- Ejecutar después de migrar clientes.
-- ============================================================

select
  whatsapp,
  count(*) as total
from public.clientes
where whatsapp is not null
  and trim(whatsapp) <> ''
group by whatsapp
having count(*) > 1
order by total desc, whatsapp;


-- ============================================================
-- 8) Validar clientes duplicados por DNI
-- Ejecutar después de migrar clientes.
-- ============================================================

select
  dni,
  count(*) as total
from public.clientes
where dni is not null
  and trim(dni) <> ''
group by dni
having count(*) > 1
order by total desc, dni;


-- ============================================================
-- 9) Validar citas sin cliente
-- Ejecutar después de migrar citas.
-- ============================================================

select
  reserva_id,
  fecha_cita,
  hora_cita,
  sede,
  cliente,
  whatsapp,
  estado
from public.citas_reservadas
where coalesce(trim(cliente), '') = ''
   or (coalesce(trim(whatsapp), '') = '' and coalesce(trim(dni), '') = '')
order by fecha_cita desc
limit 100;


-- ============================================================
-- 10) Validar movimientos sin monto o sin cliente
-- Ejecutar después de migrar movimientos.
-- ============================================================

select
  movimiento_id,
  fecha,
  hora,
  sede,
  tipo_movimiento,
  cliente,
  whatsapp,
  servicio,
  total_cobrar,
  total_pagado
from public.caja_movimientos
where coalesce(trim(cliente), '') = ''
   or coalesce(total_pagado, 0) < 0
   or coalesce(total_cobrar, 0) < 0
order by fecha desc
limit 100;


-- ============================================================
-- 11) Validar pagos sin movimiento asociado
-- Ejecutar después de migrar pagos.
-- ============================================================

select
  p.pago_id,
  p.movimiento_id,
  p.fecha,
  p.metodo,
  p.monto
from public.caja_pagos p
left join public.caja_movimientos m
  on m.movimiento_id = p.movimiento_id
where m.movimiento_id is null
order by p.fecha desc
limit 100;


-- ============================================================
-- 12) Validar suma de pagos vs movimientos
-- Ejecutar después de migrar movimientos y pagos.
-- ============================================================

select
  coalesce(sum(total_pagado), 0) as total_pagado_en_movimientos
from public.caja_movimientos;

select
  coalesce(sum(monto), 0) as total_en_pagos
from public.caja_pagos;


-- ============================================================
-- 13) Resumen de pagos por método
-- Ejecutar después de migrar pagos.
-- ============================================================

select
  metodo,
  count(*) as cantidad_pagos,
  sum(monto) as total
from public.caja_pagos
group by metodo
order by total desc;


-- ============================================================
-- 14) Resumen por sede
-- Ejecutar después de migrar movimientos.
-- ============================================================

select
  sede,
  count(*) as movimientos,
  sum(total_pagado) as total_pagado,
  sum(pendiente) as total_pendiente
from public.caja_movimientos
group by sede
order by sede;


-- ============================================================
-- 15) Boletas pendientes
-- Ejecutar después de migrar movimientos.
-- ============================================================

select
  fecha,
  sede,
  cliente,
  servicio,
  total_pagado,
  estado_boleta,
  numero_boleta,
  responsable
from public.caja_movimientos
where estado_boleta = 'Pendiente'
order by fecha desc
limit 100;


-- ============================================================
-- 16) Validar vistas principales
-- ============================================================

select *
from public.vista_citas_con_cliente
limit 20;

select *
from public.vista_movimientos_dashboard
limit 20;

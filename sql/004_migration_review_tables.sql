-- ============================================================
-- Caja Vita Lima — Supabase SQL v4
-- Archivo: sql/004_migration_review_tables.sql
-- Objetivo:
--   Crear tablas de revisión y corrección para la migración
--   de la caja real de Vita Lima.
--
-- Por qué existe:
--   Durante la migración desde Excel pueden aparecer filas dudosas,
--   movimientos mal clasificados o registros que necesitan revisión
--   manual antes o después de importar a las tablas finales.
--
-- Tablas creadas:
--   - migracion_revision
--   - migracion_correcciones
-- ============================================================


-- ============================================================
-- 1) Tabla: migracion_revision
--
-- Uso:
--   Guarda filas dudosas o pendientes de clasificación antes de
--   convertirlas definitivamente en movimientos, pagos, salidas,
--   gift cards o cupones.
-- ============================================================

create table if not exists public.migracion_revision (
  revision_id text primary key,

  -- Fuente original
  source_type text default 'MIGRACION_CAJA_REAL',
  archivo_origen text,
  hoja_origen text,
  fila_origen integer,
  source_id text,

  -- Datos originales leídos desde Excel
  fecha_original text,
  hora_original text,
  cliente_original text,
  whatsapp_original text,
  dni_original text,
  pax_original text,
  terapista_original text,
  servicio_original text,
  duracion_original text,
  efectivo_original text,
  deposito_original text,
  metodo_deposito_original text,
  izipay_original text,
  estado_boleta_original text,
  numero_boleta_original text,
  salida_original text,
  tipo_gasto_original text,
  monto_salida_original text,
  responsable_original text,
  observacion_original text,

  -- Datos detectados por el transformador
  monto_ingreso_detectado numeric default 0,
  monto_salida_detectado numeric default 0,
  tipo_detectado text,
  tipo_sugerido text,
  confianza_sugerencia numeric default 0,

  -- Revisión manual
  estado_revision text default 'PENDIENTE',
  tipo_final text,
  decision_final text,
  comentario_revision text,
  revisado_por text,
  revisado_at timestamptz,

  -- Referencias si luego se importa
  tabla_destino text,
  registro_destino_id text,
  importado boolean default false,
  importado_at timestamptz,

  -- Auditoría
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);


-- ============================================================
-- 2) Índices útiles para migracion_revision
-- ============================================================

create index if not exists idx_migracion_revision_estado
on public.migracion_revision (estado_revision);

create index if not exists idx_migracion_revision_tipo_sugerido
on public.migracion_revision (tipo_sugerido);

create index if not exists idx_migracion_revision_source_id
on public.migracion_revision (source_id);

create index if not exists idx_migracion_revision_hoja_fila
on public.migracion_revision (hoja_origen, fila_origen);


-- ============================================================
-- 3) Tabla: migracion_correcciones
--
-- Uso:
--   Guarda el historial de correcciones realizadas sobre registros
--   ya importados o revisados.
--
-- Ejemplo:
--   Un movimiento fue importado como ATENCION_HISTORICA, pero luego
--   Gerald detecta que era PRESTAMO_CAJA_INGRESO. La corrección se
--   registra aquí.
-- ============================================================

create table if not exists public.migracion_correcciones (
  correccion_id text primary key,

  -- Registro afectado
  tabla_afectada text not null,
  registro_id text not null,
  source_type text,
  source_id text,

  -- Cambio realizado
  campo_modificado text,
  valor_anterior text,
  valor_nuevo text,

  -- Contexto de corrección
  tipo_correccion text,
  motivo text,
  corregido_por text,
  created_at timestamptz default now()
);


-- ============================================================
-- 4) Índices útiles para migracion_correcciones
-- ============================================================

create index if not exists idx_migracion_correcciones_registro
on public.migracion_correcciones (tabla_afectada, registro_id);

create index if not exists idx_migracion_correcciones_source
on public.migracion_correcciones (source_id);

create index if not exists idx_migracion_correcciones_created
on public.migracion_correcciones (created_at);


-- ============================================================
-- 5) Vista: vista_migracion_revision_pendiente
--
-- Uso:
--   Permite ver rápidamente las filas pendientes de revisión.
-- ============================================================

create or replace view public.vista_migracion_revision_pendiente as
select
  revision_id,
  archivo_origen,
  hoja_origen,
  fila_origen,
  fecha_original,
  cliente_original,
  servicio_original,
  terapista_original,
  monto_ingreso_detectado,
  monto_salida_detectado,
  tipo_detectado,
  tipo_sugerido,
  confianza_sugerencia,
  estado_revision,
  comentario_revision,
  created_at
from public.migracion_revision
where estado_revision = 'PENDIENTE'
order by hoja_origen, fila_origen;


-- ============================================================
-- 6) Vista: vista_migracion_revision_resumen
--
-- Uso:
--   Resume cuántas filas hay por estado y tipo sugerido.
-- ============================================================

create or replace view public.vista_migracion_revision_resumen as
select
  estado_revision,
  coalesce(tipo_sugerido, 'SIN_TIPO') as tipo_sugerido,
  count(*) as total_filas,
  sum(coalesce(monto_ingreso_detectado, 0)) as total_ingreso_detectado,
  sum(coalesce(monto_salida_detectado, 0)) as total_salida_detectada
from public.migracion_revision
group by estado_revision, coalesce(tipo_sugerido, 'SIN_TIPO')
order by estado_revision, tipo_sugerido;


-- ============================================================
-- 7) Estados recomendados
--
-- Estos valores se usarán en estado_revision:
--
-- PENDIENTE
-- CONFIRMADO
-- RECLASIFICADO
-- IGNORADO
-- IMPORTADO
-- CORREGIDO
-- ============================================================


-- ============================================================
-- 8) Tipos finales recomendados
--
-- Estos valores se usarán en tipo_final / tipo_sugerido:
--
-- ATENCION_HISTORICA
-- APOYO_THERAPY
-- GIFT_CARD_VENTA
-- BEE_BENEFICIOS
-- CUPONIDAD
-- PRESTAMO_CAJA_INGRESO
-- DEVOLUCION_PRESTAMO_CAJA
-- SALIDA
-- IGNORAR
-- REVISAR_DESPUES
-- ============================================================


-- ============================================================
-- 9) Validación rápida
-- ============================================================

select 'migracion_revision' as tabla, count(*) as total
from public.migracion_revision
union all
select 'migracion_correcciones' as tabla, count(*) as total
from public.migracion_correcciones;

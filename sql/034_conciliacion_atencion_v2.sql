-- Caja Vita Lima — Conciliación final de atención V2
-- Migración 034
--
-- Alcance de esta primera capa:
--   * extras/upselling auditables
--   * ajustes comerciales auditables
--   * coberturas que reducen saldo sin fingir caja recibida
--   * propinas separadas de los ingresos de Vita Lima
--   * idempotencia server-only para el futuro RPC V2
--
-- Esta migración NO reemplaza los RPC V1 y NO ejecuta backfill histórico.

begin;

create table if not exists public.caja_atencion_extras (
  extra_id uuid primary key default extensions.gen_random_uuid(),
  movimiento_id text not null references public.caja_movimientos(movimiento_id) on delete restrict,
  tipo text not null check (tipo in ('MINUTOS_EXTRA','PRODUCTO','DECORACION','OTRO')),
  concepto text not null check (btrim(concepto) <> ''),
  cantidad numeric(12,2) not null default 1 check (cantidad > 0),
  monto_unitario numeric(12,2) not null check (monto_unitario >= 0),
  monto_total numeric(12,2) not null check (monto_total > 0),
  duracion_extra_min integer not null default 0 check (duracion_extra_min >= 0),
  persona_n integer check (persona_n is null or persona_n > 0),
  responsable text not null check (btrim(responsable) <> ''),
  request_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint caja_atencion_extras_total_check
    check (monto_total = round(cantidad * monto_unitario, 2))
);

create index if not exists idx_caja_atencion_extras_movimiento
  on public.caja_atencion_extras(movimiento_id);
create index if not exists idx_caja_atencion_extras_request
  on public.caja_atencion_extras(request_id);

create table if not exists public.caja_atencion_ajustes (
  ajuste_id uuid primary key default extensions.gen_random_uuid(),
  movimiento_id text not null references public.caja_movimientos(movimiento_id) on delete restrict,
  tipo text not null check (tipo in ('DESCUENTO','CORTESIA','AJUSTE_PRECIO')),
  monto numeric(12,2) not null check (monto > 0),
  motivo text not null check (btrim(motivo) <> ''),
  responsable text not null check (btrim(responsable) <> ''),
  request_id uuid not null,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_caja_atencion_ajustes_movimiento
  on public.caja_atencion_ajustes(movimiento_id);
create index if not exists idx_caja_atencion_ajustes_request
  on public.caja_atencion_ajustes(request_id);

create table if not exists public.caja_atencion_coberturas (
  cobertura_id uuid primary key default extensions.gen_random_uuid(),
  movimiento_id text not null references public.caja_movimientos(movimiento_id) on delete restrict,
  tipo text not null check (tipo in ('GIFT_CARD','CONVENIO_BEE','CONVENIO_CUPONIDAD','OTRA_COBERTURA')),
  referencia_id text,
  monto numeric(12,2) not null check (monto > 0),
  estado text not null default 'APLICADA' check (estado in ('APLICADA','REVERSADA')),
  responsable text not null check (btrim(responsable) <> ''),
  request_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  reversed_at timestamptz,
  reversed_by text,
  constraint caja_atencion_coberturas_referencia_check check (
    tipo = 'OTRA_COBERTURA' or btrim(coalesce(referencia_id, '')) <> ''
  ),
  constraint caja_atencion_coberturas_reversion_check check (
    (estado = 'APLICADA' and reversed_at is null and reversed_by is null)
    or
    (estado = 'REVERSADA' and reversed_at is not null and btrim(coalesce(reversed_by, '')) <> '')
  )
);

create index if not exists idx_caja_atencion_coberturas_movimiento
  on public.caja_atencion_coberturas(movimiento_id, estado);
create index if not exists idx_caja_atencion_coberturas_referencia
  on public.caja_atencion_coberturas(tipo, referencia_id);
create index if not exists idx_caja_atencion_coberturas_request
  on public.caja_atencion_coberturas(request_id);

create table if not exists public.caja_propinas (
  propina_id uuid primary key default extensions.gen_random_uuid(),
  movimiento_id text not null references public.caja_movimientos(movimiento_id) on delete restrict,
  fecha date not null,
  hora time not null,
  sede text not null check (btrim(sede) <> ''),
  metodo text not null check (btrim(metodo) <> ''),
  numero_operacion text,
  monto numeric(12,2) not null check (monto > 0),
  estado text not null default 'PENDIENTE' check (estado in ('PENDIENTE','ENTREGADA','ANULADA')),
  responsable text not null check (btrim(responsable) <> ''),
  request_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  anulada_en timestamptz,
  anulada_por text,
  motivo_anulacion text,
  constraint caja_propinas_operacion_check check (
    upper(btrim(metodo)) = 'EFECTIVO' or btrim(coalesce(numero_operacion, '')) <> ''
  ),
  constraint caja_propinas_anulacion_check check (
    (estado <> 'ANULADA' and anulada_en is null and anulada_por is null and motivo_anulacion is null)
    or
    (estado = 'ANULADA' and anulada_en is not null and btrim(coalesce(anulada_por, '')) <> '' and btrim(coalesce(motivo_anulacion, '')) <> '')
  )
);

create index if not exists idx_caja_propinas_movimiento
  on public.caja_propinas(movimiento_id);
create index if not exists idx_caja_propinas_fecha_sede
  on public.caja_propinas(fecha, sede);
create index if not exists idx_caja_propinas_estado
  on public.caja_propinas(estado);

create table if not exists public.caja_propina_distribucion (
  distribucion_id uuid primary key default extensions.gen_random_uuid(),
  propina_id uuid not null references public.caja_propinas(propina_id) on delete restrict,
  terapista_id uuid not null references public.terapistas(terapista_id) on delete restrict,
  monto numeric(12,2) not null check (monto > 0),
  estado text not null default 'PENDIENTE' check (estado in ('PENDIENTE','ENTREGADA','ANULADA')),
  entregado_en timestamptz,
  entregado_por text,
  created_at timestamptz not null default clock_timestamp(),
  constraint caja_propina_distribucion_entrega_check check (
    (estado = 'PENDIENTE' and entregado_en is null and entregado_por is null)
    or
    (estado = 'ENTREGADA' and entregado_en is not null and btrim(coalesce(entregado_por, '')) <> '')
    or
    (estado = 'ANULADA' and entregado_en is null)
  ),
  unique (propina_id, terapista_id)
);

create index if not exists idx_caja_propina_distribucion_terapista
  on public.caja_propina_distribucion(terapista_id, estado);

create table if not exists public.caja_conciliacion_atencion_requests (
  request_id uuid primary key,
  request_fingerprint text not null,
  movimiento_id text not null references public.caja_movimientos(movimiento_id) on delete restrict,
  reserva_id text references public.citas_reservadas(reserva_id) on delete restrict,
  respuesta jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_caja_conciliacion_requests_movimiento
  on public.caja_conciliacion_atencion_requests(movimiento_id);

-- Todo el modelo V2 es server-only. La UI opera mediante acciones/RPC controlados.
alter table public.caja_atencion_extras enable row level security;
alter table public.caja_atencion_ajustes enable row level security;
alter table public.caja_atencion_coberturas enable row level security;
alter table public.caja_propinas enable row level security;
alter table public.caja_propina_distribucion enable row level security;
alter table public.caja_conciliacion_atencion_requests enable row level security;

revoke all on table
  public.caja_atencion_extras,
  public.caja_atencion_ajustes,
  public.caja_atencion_coberturas,
  public.caja_propinas,
  public.caja_propina_distribucion,
  public.caja_conciliacion_atencion_requests
from public, anon, authenticated;

grant select, insert, update on table
  public.caja_atencion_extras,
  public.caja_atencion_ajustes,
  public.caja_atencion_coberturas,
  public.caja_propinas,
  public.caja_propina_distribucion
  to service_role;

grant select, insert on table public.caja_conciliacion_atencion_requests to service_role;

comment on table public.caja_atencion_extras is
  'Upselling/extras de una atención; aumentan la venta de Vita Lima sin reescribir el servicio base.';
comment on table public.caja_atencion_ajustes is
  'Descuentos, cortesías y ajustes de precio auditables con motivo y responsable.';
comment on table public.caja_atencion_coberturas is
  'Coberturas que reducen el saldo del cliente sin representar necesariamente dinero recibido en caja.';
comment on table public.caja_propinas is
  'Dinero recibido por cuenta de terapistas; no forma parte de ventas ni utilidad de Vita Lima.';
comment on table public.caja_propina_distribucion is
  'Distribución y entrega de propinas a terapistas del maestro vigente.';
comment on table public.caja_conciliacion_atencion_requests is
  'Idempotencia server-only para la conciliación final de atención V2.';

commit;

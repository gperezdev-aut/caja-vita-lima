-- Fixture CI para la dependencia legacy que existe en Supabase real.
-- La vista financiera V2 consume caja_venta_detalle aunque esa tabla
-- no forma parte del bootstrap histórico del runner de contratos.

create table if not exists public.caja_venta_detalle (
  linea_id uuid primary key default extensions.gen_random_uuid(),
  movimiento_id text not null references public.caja_movimientos(movimiento_id) on delete cascade,
  tipo_concepto text not null,
  concepto text not null,
  cantidad numeric(12,2) not null,
  precio_unitario numeric(12,2) not null,
  subtotal numeric(12,2) not null,
  catalogo_origen text,
  codigo_origen text,
  created_at timestamptz not null default now()
);

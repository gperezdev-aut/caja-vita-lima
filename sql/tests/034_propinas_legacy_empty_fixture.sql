-- Fixture de compatibilidad para Conciliación V2.
-- Reproduce el esquema legacy vacío observado en Supabase antes de 034.

create table if not exists public.caja_propinas (
  propina_id uuid primary key default extensions.gen_random_uuid(),
  movimiento_id text not null references public.caja_movimientos(movimiento_id) on delete restrict,
  monto_total numeric(12,2) not null check (monto_total > 0),
  fecha_operativa date not null,
  sede text not null check (btrim(sede) <> ''),
  created_at timestamptz not null default now(),
  unique (movimiento_id)
);

create table if not exists public.caja_propina_distribucion (
  distribucion_id uuid primary key default extensions.gen_random_uuid(),
  propina_id uuid not null references public.caja_propinas(propina_id) on delete cascade,
  terapista text not null check (btrim(terapista) <> ''),
  monto numeric(12,2) not null check (monto > 0),
  created_at timestamptz not null default now(),
  unique (propina_id, terapista)
);

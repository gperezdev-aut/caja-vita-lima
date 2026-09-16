-- ============================================================
-- Caja Vita Lima — Maestro de terapistas / ficha individual
-- Migración 029
-- ============================================================

create table if not exists public.terapistas (
  terapista_id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  telefono text,
  sede_habitual text,
  fecha_ingreso date,
  estado text not null default 'ACTIVA' check (estado in ('ACTIVA', 'INACTIVA')),
  observacion text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_terapistas_estado on public.terapistas(estado);
create index if not exists idx_terapistas_sede on public.terapistas(sede_habitual);

create table if not exists public.terapista_aliases (
  alias text primary key,
  terapista_id uuid not null references public.terapistas(terapista_id) on delete restrict,
  nota text,
  created_at timestamptz not null default now()
);

-- Solo las dos terapistas vigentes confirmadas se crean como fichas activas.
insert into public.terapistas (nombre, estado, observacion)
values
  ('Allison', 'ACTIVA', 'Terapista vigente. En histórico puede figurar como Alison.'),
  ('Marivel', 'ACTIVA', 'Terapista vigente confirmada para operación actual.')
on conflict (nombre) do update set
  estado = excluded.estado,
  observacion = excluded.observacion,
  updated_at = now();

insert into public.terapista_aliases (alias, terapista_id, nota)
select 'Alison', terapista_id, 'Nombre histórico usado previamente en Caja.'
from public.terapistas
where nombre = 'Allison'
on conflict (alias) do update set
  terapista_id = excluded.terapista_id,
  nota = excluded.nota;

-- Saneamiento no destructivo de la lista operativa existente.
-- No se borra ningún histórico. Solo se controla qué aparece en nuevos registros.
update public.config_listas
set activo = false,
    updated_at = now()
where lista = 'TERAPISTAS';

-- Compatibilidad con el nombre histórico ya existente.
update public.config_listas
set valor = 'Allison',
    activo = true,
    orden = 1,
    alias_de = 'Alison',
    nota = 'Terapista activa; Alison se conserva como alias histórico.',
    updated_at = now()
where lista = 'TERAPISTAS'
  and valor = 'Alison';

-- Idempotencia: si la migración ya se ejecutó antes, Allison ya existe con su nombre canónico.
update public.config_listas
set activo = true,
    orden = 1,
    alias_de = coalesce(alias_de, 'Alison'),
    nota = 'Terapista activa; Alison se conserva como alias histórico.',
    updated_at = now()
where lista = 'TERAPISTAS'
  and valor = 'Allison';

insert into public.config_listas (lista, valor, orden, activo, alias_de, nota)
select 'TERAPISTAS', 'Allison', 1, true, 'Alison', 'Terapista activa; Alison se conserva como alias histórico.'
where not exists (
  select 1
  from public.config_listas
  where lista = 'TERAPISTAS' and valor = 'Allison'
);

insert into public.config_listas (lista, valor, orden, activo, alias_de, nota)
select 'TERAPISTAS', 'Marivel', 2, true, null, 'Terapista activa vigente.'
where not exists (
  select 1
  from public.config_listas
  where lista = 'TERAPISTAS' and valor = 'Marivel'
);

update public.config_listas
set activo = true,
    orden = 2,
    updated_at = now()
where lista = 'TERAPISTAS'
  and valor = 'Marivel';

-- "Otro" sigue siendo una opción técnica, no una ficha de persona.
update public.config_listas
set activo = true,
    orden = 99,
    nota = 'Opción técnica para registrar una terapista no listada.',
    updated_at = now()
where lista = 'TERAPISTAS'
  and valor = 'Otro';

-- Validaciones sugeridas post-migración:
-- select * from public.terapistas order by nombre;
-- select * from public.terapista_aliases order by alias;
-- select id, valor, orden, activo, alias_de, nota
-- from public.config_listas
-- where lista = 'TERAPISTAS'
-- order by orden nulls last, valor;

-- 026 · Clientes como fuente maestra e identidad telefónica internacional.
--
-- Esta migración es aditiva. No convierte, borra ni reclasifica teléfonos
-- históricos: una cadena local sin país no permite inferir +51 con seguridad.
-- Ejecutar las consultas PRE-CHECK antes de aplicarla en cada entorno.

-- PRE-CHECK: no debe haber duplicados antes de confiar en la llave canónica.
select whatsapp_e164, count(*) as cantidad, array_agg(cliente_id order by cliente_id) as cliente_ids
from public.clientes
where whatsapp_e164 is not null
group by whatsapp_e164
having count(*) > 1;

-- PRE-CHECK: filas históricas que deben revisarse antes de una importación o
-- sincronización externa. No se actualizan automáticamente en esta migración.
select cliente_id, cliente, whatsapp, whatsapp_e164, pais_telefono
from public.clientes
where (nullif(btrim(coalesce(whatsapp, '')), '') is not null and whatsapp_e164 is null)
   or (whatsapp_e164 is not null and nullif(btrim(coalesce(pais_telefono, '')), '') is null)
   or (whatsapp_e164 is not null and whatsapp_e164 !~ '^\+[1-9][0-9]{7,14}$')
order by updated_at nulls first, cliente_id;

alter table public.clientes
  add column if not exists telefono_estado text,
  add column if not exists telefono_normalizacion_origen text,
  add column if not exists telefono_normalizado_en timestamptz;

-- NULL conserva explícitamente los históricos que aún no fueron evaluados.
-- Las escrituras nuevas reciben uno de estos valores mediante el trigger.
alter table public.clientes drop constraint if exists chk_clientes_telefono_estado;
alter table public.clientes
  add constraint chk_clientes_telefono_estado
  check (telefono_estado is null or telefono_estado in ('CANONICO', 'PENDIENTE_REVISION', 'SIN_TELEFONO'));

alter table public.clientes drop constraint if exists chk_clientes_telefono_normalizacion_origen;
alter table public.clientes
  add constraint chk_clientes_telefono_normalizacion_origen
  check (telefono_normalizacion_origen is null or telefono_normalizacion_origen in (
    'APP_PAIS_DECLARADO', 'IMPORTACION_PAIS_DECLARADO', 'REVISION_MANUAL',
    'LEGADO_SIN_VERIFICAR', 'SIN_NORMALIZAR'
  ));

alter table public.clientes drop constraint if exists chk_clientes_telefono_canonico;
alter table public.clientes
  add constraint chk_clientes_telefono_canonico
  check (
    telefono_estado is distinct from 'CANONICO'
    or (
      whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$'
      and pais_telefono ~ '^[A-Z]{2}$'
      and telefono_normalizacion_origen is not null
    )
  );

create or replace function public.caja_clientes_resolver_estado_telefono_v1()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Solo clasifica escrituras de teléfono nuevas o modificadas. Así, una
  -- actualización no telefónica no "certifica" datos históricos por accidente.
  if tg_op = 'UPDATE'
     and new.whatsapp is not distinct from old.whatsapp
     and new.whatsapp_e164 is not distinct from old.whatsapp_e164
     and new.pais_telefono is not distinct from old.pais_telefono then
    return new;
  end if;

  new.whatsapp := nullif(btrim(new.whatsapp), '');
  new.whatsapp_e164 := nullif(btrim(new.whatsapp_e164), '');
  new.pais_telefono := nullif(upper(btrim(new.pais_telefono)), '');

  if new.whatsapp_e164 is not null
     and new.whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$'
     and new.pais_telefono ~ '^[A-Z]{2}$' then
    new.telefono_estado := 'CANONICO';
    new.telefono_normalizacion_origen := coalesce(
      nullif(btrim(new.telefono_normalizacion_origen), ''),
      'APP_PAIS_DECLARADO'
    );
    new.telefono_normalizado_en := coalesce(new.telefono_normalizado_en, now());
  elsif new.whatsapp is not null or new.whatsapp_e164 is not null then
    -- No se inventa un país ni se convierte el crudo a E.164 aquí.
    new.telefono_estado := 'PENDIENTE_REVISION';
    new.telefono_normalizacion_origen := coalesce(
      nullif(btrim(new.telefono_normalizacion_origen), ''),
      'SIN_NORMALIZAR'
    );
    new.telefono_normalizado_en := null;
  else
    new.telefono_estado := 'SIN_TELEFONO';
    new.telefono_normalizacion_origen := null;
    new.telefono_normalizado_en := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_clientes_resolver_estado_telefono_v1 on public.clientes;
create trigger trg_clientes_resolver_estado_telefono_v1
before insert or update of whatsapp, whatsapp_e164, pais_telefono on public.clientes
for each row execute function public.caja_clientes_resolver_estado_telefono_v1();

create index if not exists idx_clientes_telefono_revision
  on public.clientes (updated_at, cliente_id)
  where telefono_estado = 'PENDIENTE_REVISION';

-- CLIENTES / CRM
-- La vista anterior no está versionada en este repositorio, por lo que no se
-- reemplaza a ciegas. Esta vista nueva tiene una única base: clientes. Las
-- métricas operativas son complementarias mediante LEFT JOIN; un maestro sin
-- citas ni movimientos conserva exactamente una fila con ceros y fechas NULL.
create or replace view public.vista_clientes_crm_catalogo_master_v1 as
with movimientos as (
  select
    cliente_id,
    count(*)::integer as total_visitas,
    coalesce(sum(total_pagado), 0)::numeric as total_gastado,
    max(fecha) as ultima_visita_operativa,
    (array_agg(sede order by fecha desc nulls last, hora desc nulls last))[1] as sede_frecuente,
    (array_agg(servicio order by fecha desc nulls last, hora desc nulls last))[1] as ultimo_servicio_operativo
  from public.caja_movimientos
  where cliente_id is not null
  group by cliente_id
),
reservas as (
  select
    cliente_id,
    count(*)::integer as total_reservas,
    min(fecha_cita) as primera_reserva_operativa,
    max(fecha_cita) as ultima_reserva_operativa
  from public.citas_reservadas
  where cliente_id is not null
  group by cliente_id
),
servicio_favorito as (
  select distinct on (cliente_id)
    cliente_id,
    servicio as servicio_mas_comprado
  from (
    select cliente_id, servicio, count(*) as cantidad, max(fecha) as ultima_fecha
    from public.caja_movimientos
    where cliente_id is not null and nullif(btrim(servicio), '') is not null
    group by cliente_id, servicio
  ) conteo
  order by cliente_id, cantidad desc, ultima_fecha desc nulls last, servicio
)
select
  c.*,
  coalesce(m.total_visitas, 0)::integer as total_visitas,
  coalesce(m.total_gastado, 0)::numeric as total_gastado,
  coalesce(m.ultima_visita_operativa, c.ultima_visita) as ultima_visita_crm,
  coalesce(r.total_reservas, c.total_reservas, 0)::integer as total_reservas_crm,
  coalesce(r.primera_reserva_operativa, c.primera_reserva) as primera_reserva_crm,
  coalesce(r.ultima_reserva_operativa, c.ultima_reserva) as ultima_reserva_crm,
  coalesce(m.sede_frecuente, c.ultima_sede) as sede_frecuente,
  coalesce(sf.servicio_mas_comprado, m.ultimo_servicio_operativo, c.ultimo_servicio) as servicio_mas_comprado,
  case
    when m.ultima_visita_operativa is null and r.ultima_reserva_operativa is null then 'SIN_ACTIVIDAD'
    when coalesce(m.ultima_visita_operativa, r.ultima_reserva_operativa) < current_date - 60 then 'INACTIVO'
    else 'ACTIVO'
  end as estado_actividad_crm,
  case
    when nullif(btrim(c.whatsapp), '') is not null then 'CON_WHATSAPP'
    when nullif(btrim(c.email), '') is not null or nullif(btrim(c.dni), '') is not null then 'CON_DATO_PARCIAL'
    else 'SIN_CONTACTO'
  end as calidad_contacto_crm
from public.clientes c
left join movimientos m on m.cliente_id = c.cliente_id
left join reservas r on r.cliente_id = c.cliente_id
left join servicio_favorito sf on sf.cliente_id = c.cliente_id;

-- VALIDACIÓN: debe devolver cero filas. Si devuelve una, la vista dejó fuera
-- un cliente maestro y no debe usarse para la importación histórica.
select c.cliente_id
from public.clientes c
left join public.vista_clientes_crm_catalogo_master_v1 v on v.cliente_id = c.cliente_id
where v.cliente_id is null;

-- VALIDACIÓN POSTERIOR: las nuevas filas canónicas deben conservar los tres
-- componentes de identidad. Las filas legacy con estado NULL se revisan aparte.
select cliente_id, whatsapp, whatsapp_e164, pais_telefono,
       telefono_estado, telefono_normalizacion_origen, telefono_normalizado_en
from public.clientes
where telefono_estado = 'CANONICO'
  and (
    whatsapp_e164 !~ '^\+[1-9][0-9]{7,14}$'
    or pais_telefono !~ '^[A-Z]{2}$'
    or telefono_normalizacion_origen is null
  );

-- COLA OPERATIVA DE REVISIÓN: no incluye teléfonos vacíos.
select cliente_id, cliente, whatsapp, whatsapp_e164, pais_telefono,
       telefono_estado, telefono_normalizacion_origen
from public.clientes
where telefono_estado = 'PENDIENTE_REVISION'
   or (
     telefono_estado is null
     and (whatsapp is not null or whatsapp_e164 is not null)
   )
order by updated_at nulls first, cliente_id;

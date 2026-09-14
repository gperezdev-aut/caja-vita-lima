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
    when case
      when m.ultima_visita_operativa is null then r.ultima_reserva_operativa
      when r.ultima_reserva_operativa is null then m.ultima_visita_operativa
      else greatest(m.ultima_visita_operativa, r.ultima_reserva_operativa)
    end < current_date - 60 then 'INACTIVO'
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

-- LISTADO ESCALABLE DE CLIENTES
-- La vista CRM heredada no se sustituye ni se intenta reconstruir con columnas
-- supuestas. Esta función parte exclusivamente de clientes y conserva cada
-- campo heredado como JSONB al enriquecer por cliente_id. Así el contrato CRM
-- existente se mantiene incluso si incorpora columnas todavía no versionadas.
--
-- Devuelve una sola carga con: página, métricas de TODO el conjunto filtrado,
-- top y recuperación. p_limit se acota para impedir que la UI vuelva a traer
-- miles de maestros en una petición; p_offset permite paginar más allá de
-- 1,000/2,000/10,000 filas sin depender del límite por defecto de PostgREST.
-- Un offset posterior al final se resuelve atómicamente a la última página
-- existente; nunca devuelve una página vacía que la interfaz presente como válida.
create or replace function public.caja_clientes_crm_catalogo_paginado_v1(
  p_q text default null,
  p_estado text default 'TODOS',
  p_actividad text default 'TODOS',
  p_contacto text default 'TODOS',
  p_sede text default 'TODAS',
  p_tipo text default 'TODOS',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(payload jsonb)
language sql
stable
set search_path = public
as $$
with parametros as (
  select
    nullif(btrim(p_q), '') as busqueda,
    coalesce(nullif(btrim(p_estado), ''), 'TODOS') as estado,
    coalesce(nullif(btrim(p_actividad), ''), 'TODOS') as actividad,
    coalesce(nullif(btrim(p_contacto), ''), 'TODOS') as contacto,
    coalesce(nullif(btrim(p_sede), ''), 'TODAS') as sede,
    coalesce(nullif(btrim(p_tipo), ''), 'TODOS') as tipo,
    least(greatest(coalesce(p_limit, 50), 1), 100) as limite,
    greatest(coalesce(p_offset, 0), 0) as desplazamiento
),
maestros as (
  select
    c.cliente_id,
    -- Los valores seguros se aplican solo si la vista heredada no los aporta.
    -- El último || deja que la vista conserve íntegro su contrato conocido.
    to_jsonb(c)
      || jsonb_build_object(
        'total_visitas', 0,
        'total_gastado', 0,
        'total_reservas', coalesce(c.total_reservas, 0),
        'estado_actividad_crm', 'SIN_ACTIVIDAD',
        'calidad_contacto_crm', case
          when nullif(btrim(c.whatsapp), '') is not null then 'CON_WHATSAPP'
          when nullif(btrim(c.email), '') is not null or nullif(btrim(c.dni), '') is not null then 'CON_DATO_PARCIAL'
          else 'SIN_CONTACTO'
        end
      )
      || coalesce(to_jsonb(v), '{}'::jsonb) as fila
  from public.clientes c
  left join public.vista_clientes_crm_catalogo v on v.cliente_id = c.cliente_id
),
normalizados as (
  select
    cliente_id,
    fila,
    coalesce(nullif(fila->>'estado_cliente_crm', ''), nullif(fila->>'nivel_cliente_crm', ''), nullif(fila->>'segmento_cliente', ''), '-') as estado_crm,
    case upper(coalesce(nullif(fila->>'calidad_contacto_crm', ''), ''))
      when 'CON_WHATSAPP' then 'Con WhatsApp'
      when 'CON_DATO_PARCIAL' then 'Con dato parcial'
      when 'HISTORICO_SIN_CONTACTO' then 'Histórico sin contacto'
      when 'SIN_CONTACTO' then 'Sin contacto'
      else coalesce(nullif(fila->>'calidad_contacto_crm', ''), case
        when nullif(fila->>'whatsapp', '') is not null then 'Con WhatsApp'
        when nullif(fila->>'dni', '') is not null or nullif(fila->>'email', '') is not null then 'Con dato parcial'
        else 'Sin contacto'
      end)
    end as contacto_crm,
    coalesce(nullif(fila->>'sede_frecuente', ''), nullif(fila->>'ultima_sede', ''), '-') as sede_crm,
    coalesce(nullif(fila->>'servicio_mas_comprado_catalogo_tipo', ''), '') as catalogo_tipo,
    coalesce(nullif(fila->>'servicio_mas_comprado_menu_group', ''), '') as menu_group,
    nullif(coalesce(fila->>'ultima_visita_crm', fila->>'ultima_visita'), '')::date as ultima_visita,
    nullif(coalesce(fila->>'ultima_reserva_crm', fila->>'ultima_reserva'), '')::date as ultima_reserva,
    coalesce(nullif(fila->>'total_gastado', ''), '0')::numeric as total_gastado,
    coalesce(nullif(fila->>'total_visitas', ''), nullif(fila->>'total_reservas', ''), '0')::integer as total_visitas
  from maestros
),
con_actividad as (
  select *,
    case
      when ultima_visita is null and ultima_reserva is null then 'Sin fecha'
      when case
        when ultima_visita is null then ultima_reserva
        when ultima_reserva is null then ultima_visita
        else greatest(ultima_visita, ultima_reserva)
      end < current_date - 60 then 'Inactivo'
      else 'Activo'
    end as actividad_crm
  from normalizados
),
filtrados as (
  select n.*
  from con_actividad n
  cross join parametros p
  where (
      p.busqueda is null
      or n.fila->>'cliente' ilike '%' || p.busqueda || '%'
      or n.fila->>'whatsapp' ilike '%' || p.busqueda || '%'
      or n.fila->>'dni' ilike '%' || p.busqueda || '%'
      or n.fila->>'servicio_mas_comprado' ilike '%' || p.busqueda || '%'
      or n.fila->>'servicio_mas_comprado_catalogo_nombre' ilike '%' || p.busqueda || '%'
      or n.fila->>'ultimo_servicio' ilike '%' || p.busqueda || '%'
    )
    and (p.estado = 'TODOS' or n.estado_crm = p.estado)
    and (p.actividad = 'TODOS' or n.actividad_crm = p.actividad)
    and (p.contacto = 'TODOS' or n.contacto_crm = p.contacto)
    and (p.sede = 'TODAS' or n.sede_crm = p.sede)
    and (
      p.tipo = 'TODOS'
      or (p.tipo = 'CATALOGO' and n.catalogo_tipo = 'SERVICIO')
      or (p.tipo = 'HISTORICO' and n.catalogo_tipo in ('SERVICIO_HISTORICO', 'PROMO_HISTORICA'))
      or (p.tipo = 'PACK_2P' and n.menu_group = 'PACK_2P')
      or (p.tipo = 'PROMOS_1P' and n.menu_group = 'PROMOS_1P')
      or (p.tipo = 'SESSIONS' and n.menu_group = 'SESSIONS')
      or (p.tipo = 'GIFT_CARD' and n.catalogo_tipo = 'GIFT_CARD')
    )
),
resumen as (
  select
    count(*)::integer as total_clientes,
    coalesce(sum(total_gastado), 0)::numeric as total_gastado,
    coalesce(sum(total_visitas), 0)::integer as total_visitas,
    count(*) filter (where contacto_crm = 'Con WhatsApp')::integer as con_whatsapp,
    count(*) filter (where estado_crm = 'VIP' and actividad_crm = 'Inactivo')::integer as vip_inactivos,
    count(*) filter (where catalogo_tipo in ('SERVICIO_HISTORICO', 'PROMO_HISTORICA'))::integer as historicos
  from filtrados
),
paginacion as (
  select
    p.limite,
    case
      when r.total_clientes = 0 then 0
      else least(
        p.desplazamiento,
        ((r.total_clientes - 1) / p.limite) * p.limite
      )
    end as desplazamiento_resuelto,
    case
      when r.total_clientes = 0 then 1
      else ((r.total_clientes - 1) / p.limite) + 1
    end as total_paginas
  from parametros p
  cross join resumen r
),
ordenados as (
  select * from filtrados order by total_gastado desc, cliente_id
),
pagina as (
  select o.*
  from ordenados o
  cross join paginacion p
  limit p.limite offset p.desplazamiento_resuelto
),
top_clientes as (
  select * from ordenados limit 8
),
clientes_recuperar as (
  select *
  from ordenados
  where actividad_crm = 'Inactivo' or estado_crm = 'Inactivo'
  limit 10
)
select jsonb_build_object(
  'clientes', coalesce((select jsonb_agg(fila order by total_gastado desc, cliente_id) from pagina), '[]'::jsonb),
  'resumen', (select to_jsonb(resumen) from resumen),
  'paginacion', (select jsonb_build_object(
    'offset', desplazamiento_resuelto,
    'limite', limite,
    'total_paginas', total_paginas
  ) from paginacion),
  'top', coalesce((select jsonb_agg(fila order by total_gastado desc, cliente_id) from top_clientes), '[]'::jsonb),
  'recuperar', coalesce((select jsonb_agg(fila order by total_gastado desc, cliente_id) from clientes_recuperar), '[]'::jsonb)
);
$$;

-- VALIDACIÓN: debe devolver cero filas. Si devuelve una, la vista dejó fuera
-- un cliente maestro y no debe usarse para la importación histórica.
select c.cliente_id
from public.clientes c
left join public.vista_clientes_crm_catalogo_master_v1 v on v.cliente_id = c.cliente_id
where v.cliente_id is null;

-- STAGING READ-ONLY: antes de aplicar 026, guardar la definición y el
-- contrato real heredado. La aplicación conserva esa vista y solo añade los
-- maestros que esta no devuelva, hasta que ambos contratos sean comparables.
select pg_get_viewdef('public.vista_clientes_crm_catalogo'::regclass, true) as definicion_sql;

select column_name, data_type, is_nullable, ordinal_position
from information_schema.columns
where table_schema = 'public'
  and table_name = 'vista_clientes_crm_catalogo'
order by ordinal_position;

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

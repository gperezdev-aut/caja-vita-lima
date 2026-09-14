-- Corrige vistas del ledger que usaban FULL OUTER JOIN con IS NOT DISTINCT FROM.
-- PostgreSQL no puede ejecutar FULL JOIN con esa condición porque no es hash/merge-joinable.
-- Se conserva la semántica null-safe mediante COALESCE a sentinelas fuera del dominio operativo.
begin;

create or replace view public.vista_ingresos_por_tipo_movimiento as
with operaciones as (
  select tipo_movimiento, count(*) as cantidad_movimientos
  from public.caja_movimientos
  group by tipo_movimiento
), ingresos as (
  select m.tipo_movimiento, coalesce(sum(p.monto), 0) as total
  from public.caja_pagos p
  left join public.caja_movimientos m on m.movimiento_id = p.movimiento_id
  group by m.tipo_movimiento
)
select
  coalesce(o.tipo_movimiento, i.tipo_movimiento) as tipo_movimiento,
  coalesce(o.cantidad_movimientos, 0) as cantidad_movimientos,
  coalesce(i.total, 0) as total
from operaciones o
full outer join ingresos i
  on coalesce(i.tipo_movimiento, '__CAJA_NULL__') = coalesce(o.tipo_movimiento, '__CAJA_NULL__')
order by total desc;

create or replace view public.vista_ingresos_por_fecha as
with operaciones as (
  select fecha, sede, count(*) as cantidad_movimientos,
    coalesce(sum(pendiente), 0) as total_pendiente
  from public.caja_movimientos
  group by fecha, sede
), ingresos as (
  select fecha, sede, coalesce(sum(monto), 0) as total_pagado
  from public.caja_pagos
  group by fecha, sede
)
select
  coalesce(o.fecha, i.fecha) as fecha,
  coalesce(o.sede, i.sede) as sede,
  coalesce(o.cantidad_movimientos, 0) as cantidad_movimientos,
  coalesce(i.total_pagado, 0) as total_pagado,
  coalesce(o.total_pendiente, 0) as total_pendiente
from operaciones o
full outer join ingresos i
  on coalesce(i.fecha, date '0001-01-01') = coalesce(o.fecha, date '0001-01-01')
 and coalesce(i.sede, '__CAJA_NULL__') = coalesce(o.sede, '__CAJA_NULL__')
order by fecha desc, sede;

create or replace view public.vista_ingresos_por_mes as
with operaciones as (
  select date_trunc('month', fecha)::date as mes, sede,
    count(*) as cantidad_movimientos,
    coalesce(sum(pendiente), 0) as total_pendiente
  from public.caja_movimientos
  group by date_trunc('month', fecha)::date, sede
), ingresos as (
  select date_trunc('month', fecha)::date as mes, sede,
    coalesce(sum(monto), 0) as total_pagado
  from public.caja_pagos
  group by date_trunc('month', fecha)::date, sede
)
select
  coalesce(o.mes, i.mes) as mes,
  coalesce(o.sede, i.sede) as sede,
  coalesce(o.cantidad_movimientos, 0) as cantidad_movimientos,
  coalesce(i.total_pagado, 0) as total_pagado,
  coalesce(o.total_pendiente, 0) as total_pendiente
from operaciones o
full outer join ingresos i
  on coalesce(i.mes, date '0001-01-01') = coalesce(o.mes, date '0001-01-01')
 and coalesce(i.sede, '__CAJA_NULL__') = coalesce(o.sede, '__CAJA_NULL__')
order by mes desc, sede;

commit;

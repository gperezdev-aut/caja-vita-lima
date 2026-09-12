-- READ-ONLY. No corrige, actualiza ni elimina datos.
-- Identifica pagos cuya fecha coincide con la cita/movimiento, pero difiere
-- de la fecha de inserción en America/Lima. Es una señal, no una prueba.
select
  p.pago_id,
  p.movimiento_id,
  p.fecha as fecha_registrada_pago,
  p.hora as hora_registrada_pago,
  m.fecha as fecha_operativa_movimiento,
  m.hora as hora_operativa_movimiento,
  (p.created_at at time zone 'America/Lima')::date as fecha_creacion_lima,
  (p.created_at at time zone 'America/Lima')::time as hora_creacion_lima,
  p.sede,
  p.tipo_pago,
  p.metodo,
  p.monto,
  m.source_type,
  case
    when p.fecha = m.fecha
      and p.fecha is distinct from (p.created_at at time zone 'America/Lima')::date
      then 'PROBABLE_FECHA_CITA_COPIADA'
    when p.fecha = m.fecha then 'COINCIDE_CON_FECHA_OPERATIVA'
    when p.fecha is distinct from (p.created_at at time zone 'America/Lima')::date
      then 'REVISAR_FECHA_VS_CREATED_AT'
    else 'SIN_SENAL_POR_FECHA'
  end as diagnostico
from public.caja_pagos p
left join public.caja_movimientos m on m.movimiento_id = p.movimiento_id
where p.tipo_pago = 'ADELANTO_APP'
   or m.source_type = 'APP_CAJA_FICHA'
order by p.created_at, p.pago_id;

-- Conciliación no destructiva del acumulado operativo contra el ledger.
select
  m.movimiento_id,
  m.fecha as fecha_operativa,
  m.sede,
  m.total_pagado,
  coalesce(sum(p.monto), 0) as total_en_ledger,
  m.total_pagado - coalesce(sum(p.monto), 0) as diferencia
from public.caja_movimientos m
left join public.caja_pagos p on p.movimiento_id = m.movimiento_id
group by m.movimiento_id, m.fecha, m.sede, m.total_pagado
having m.total_pagado is distinct from coalesce(sum(p.monto), 0)
order by abs(m.total_pagado - coalesce(sum(p.monto), 0)) desc, m.movimiento_id;

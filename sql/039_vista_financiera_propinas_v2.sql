-- 039_vista_financiera_propinas_v2.sql
-- Las propinas V2 viven en su ledger propio y NO forman parte de total_cobrar.
-- La vista conserva sus columnas/contrato, pero solo compara contra
-- caja_movimientos.total_propina las propinas legacy (request_id IS NULL).

create or replace view public.vista_caja_movimiento_financiero_v2 as
with pagos_por_movimiento as (
  select
    movimiento_id,
    count(*) as cantidad_pagos,
    coalesce(sum(coalesce(monto, 0)), 0) as cobro_total
  from public.caja_pagos
  group by movimiento_id
), extras_por_movimiento as (
  select
    movimiento_id,
    count(*) as cantidad_lineas_extras,
    coalesce(sum(coalesce(subtotal, 0)), 0) as total_extras
  from public.caja_venta_detalle
  group by movimiento_id
), propinas_por_movimiento as (
  select
    movimiento_id,
    count(*) as cantidad_registros_propina,
    coalesce(sum(coalesce(monto_total, 0)), 0) as total_propina_detalle,
    coalesce(sum(coalesce(monto_total, 0)) filter (where request_id is not null), 0) as total_propina_v2,
    coalesce(sum(coalesce(monto_total, 0)) filter (where request_id is null), 0) as total_propina_legacy
  from public.caja_propinas
  group by movimiento_id
), base as (
  select
    m.movimiento_id,
    m.fecha,
    date_trunc('month', m.fecha::timestamp with time zone)::date as mes,
    coalesce(nullif(btrim(m.sede), ''), 'SIN_SEDE') as sede,
    m.sede as sede_origen,
    m.tipo_movimiento,
    m.cliente_id,
    m.servicio,
    coalesce(m.monto_servicio, 0) as monto_servicio,
    coalesce(e.total_extras, 0) as total_extras,
    coalesce(m.total_extras, 0) as total_extras_movimiento,
    coalesce(m.total_propina, 0) as total_propina,
    coalesce(pr.total_propina_detalle, 0) as total_propina_detalle,
    coalesce(pr.total_propina_v2, 0) as total_propina_v2,
    coalesce(pr.total_propina_legacy, 0) as total_propina_legacy,
    coalesce(m.total_cobrar, 0) as total_cobrar,
    coalesce(m.total_pagado, 0) as total_pagado_movimiento,
    coalesce(pg.cobro_total, 0) as cobro_total,
    coalesce(m.pendiente, 0) as pendiente,
    coalesce(pg.cantidad_pagos, 0) as cantidad_pagos,
    coalesce(e.cantidad_lineas_extras, 0) as cantidad_lineas_extras,
    coalesce(pr.cantidad_registros_propina, 0) as cantidad_registros_propina,
    m.tipo_comprobante,
    coalesce(nullif(btrim(m.estado_comprobante_manual), ''), nullif(btrim(m.estado_boleta), ''), 'SIN_ESTADO') as estado_comprobante
  from public.caja_movimientos m
  left join pagos_por_movimiento pg on pg.movimiento_id = m.movimiento_id
  left join extras_por_movimiento e on e.movimiento_id = m.movimiento_id
  left join propinas_por_movimiento pr on pr.movimiento_id = m.movimiento_id
), clasificada as (
  select
    b.*,
    case
      when b.tipo_movimiento = any(array['ATENCION_HISTORICA'::text, 'ATENCION_APP'::text]) then 'SERVICIO'
      when b.tipo_movimiento = 'RESERVA_APP' then 'SERVICIO_RESERVADO'
      when b.tipo_movimiento = 'GIFT_CARD_VENTA' then 'GIFT_CARD_VENDIDA'
      when b.tipo_movimiento = 'GIFT_CARD_CANJE' then 'GIFT_CARD_CANJE'
      when b.tipo_movimiento = 'PRESTAMO_CAJA_INGRESO' then 'PRESTAMO_RECIBIDO'
      when b.tipo_movimiento = 'DEVOLUCION_PRESTAMO_CAJA' then 'DEVOLUCION_PRESTAMO'
      when b.tipo_movimiento = 'CUPONIDAD' then 'CONVENIO'
      when greatest(b.cobro_total, b.total_pagado_movimiento, b.total_cobrar) > 0 then 'OTRO_INGRESO'
      else 'SIN_CLASIFICAR'
    end as categoria_financiera
  from base b
), operacion as (
  select
    c.*,
    case
      when c.categoria_financiera = 'SERVICIO' then 'REALIZADO'
      when c.categoria_financiera = 'SERVICIO_RESERVADO' then 'RESERVADO'
      when c.categoria_financiera = 'CONVENIO' then 'CONVENIO_ATENDIDO'
      when c.categoria_financiera = 'GIFT_CARD_VENDIDA' then 'VENDIDA'
      when c.categoria_financiera = 'GIFT_CARD_CANJE' then 'CANJE_PENDIENTE_REGLA'
      when c.categoria_financiera = 'PRESTAMO_RECIBIDO' then 'FINANCIAMIENTO'
      when c.categoria_financiera = 'DEVOLUCION_PRESTAMO' then 'DEVOLUCION'
      when c.categoria_financiera = 'OTRO_INGRESO' then 'OTRO'
      else 'SIN_CLASIFICAR'
    end as etapa_operativa,
    case
      when c.categoria_financiera = any(array['SERVICIO'::text, 'CONVENIO'::text]) then c.monto_servicio + c.total_extras
      else 0
    end as venta_operativa,
    case
      when c.categoria_financiera = any(array['SERVICIO'::text, 'CONVENIO'::text]) then least(greatest(c.cobro_total, 0), greatest(c.monto_servicio + c.total_extras, 0))
      else 0
    end as cobro_operativo_estimado
  from clasificada c
)
select
  movimiento_id,
  fecha,
  mes,
  sede,
  sede_origen,
  tipo_movimiento,
  categoria_financiera,
  etapa_operativa,
  cliente_id,
  servicio,
  monto_servicio,
  total_extras,
  total_extras_movimiento,
  total_propina,
  total_propina_detalle,
  venta_operativa,
  total_cobrar,
  total_pagado_movimiento,
  cobro_total,
  case when categoria_financiera = 'SERVICIO_RESERVADO' then greatest(cobro_total, 0) else 0 end as adelanto_reserva,
  case when categoria_financiera = 'SERVICIO_RESERVADO' then greatest(total_cobrar - cobro_total, 0) else 0 end as pendiente_reserva,
  case when categoria_financiera = any(array['SERVICIO'::text, 'CONVENIO'::text]) then greatest(total_cobrar - cobro_total, 0) else 0 end as pendiente_operativo_por_cobrar,
  pendiente,
  cobro_operativo_estimado,
  (categoria_financiera = any(array['SERVICIO'::text, 'CONVENIO'::text])) and cobro_total > 0 as asignacion_pago_estimada,
  cobro_total - total_pagado_movimiento as diferencia_conciliacion_pago,
  total_extras - total_extras_movimiento as diferencia_conciliacion_extras,
  total_propina_legacy - total_propina as diferencia_conciliacion_propina,
  total_cobrar - (monto_servicio + total_extras + total_propina) as diferencia_conciliacion_total_cobrar,
  pendiente - (total_cobrar - cobro_total) as diferencia_conciliacion_pendiente,
  (
    cobro_total <> total_pagado_movimiento
    or total_extras <> total_extras_movimiento
    or total_propina_legacy <> total_propina
    or total_cobrar <> (monto_servicio + total_extras + total_propina)
    or pendiente <> (total_cobrar - cobro_total)
  ) as diferencia_conciliacion,
  case
    when total_cobrar <= 0 and cobro_total <= 0 then 'SIN_MONTO'
    when cobro_total <= 0 then 'PENDIENTE'
    when cobro_total < total_cobrar then 'PARCIAL'
    when cobro_total = total_cobrar then 'PAGADO'
    else 'SOBREPAGO'
  end as estado_pago_calculado,
  tipo_comprobante,
  estado_comprobante,
  cantidad_pagos,
  cantidad_lineas_extras,
  cantidad_registros_propina,
  categoria_financiera = 'SERVICIO' as es_servicio_realizado,
  categoria_financiera = 'SERVICIO_RESERVADO' as es_reserva,
  categoria_financiera = any(array['GIFT_CARD_VENDIDA'::text, 'GIFT_CARD_CANJE'::text]) as es_gift_card,
  categoria_financiera = 'CONVENIO' as es_convenio,
  categoria_financiera = any(array['PRESTAMO_RECIBIDO'::text, 'DEVOLUCION_PRESTAMO'::text]) as es_prestamo,
  categoria_financiera = 'OTRO_INGRESO' as es_otro
from operacion;

comment on view public.vista_caja_movimiento_financiero_v2 is
  'Vista financiera compatible con propinas V2 separadas: las propinas con request_id no forman parte de total_cobrar ni generan falsa diferencia de conciliación.';

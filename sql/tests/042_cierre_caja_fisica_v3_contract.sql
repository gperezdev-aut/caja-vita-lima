-- 042_cierre_caja_fisica_v3_contract.sql
-- Contrato ejecutable y aislado para la migración 042.

do $$
declare
  v_metodo text;
  v_count integer;
begin
  select metodo_salida
    into v_metodo
  from public.caja_salidas
  where salida_id = 'LEGACY-001';

  if v_metodo is not null then
    raise exception '042 debe conservar históricos sin asumir método';
  end if;

  if to_regclass('public.caja_movimientos_fondos') is null then
    raise exception '042 no creó public.caja_movimientos_fondos';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='caja_salidas'
      and column_name='categoria_financiera'
  ) then
    raise exception '042 no aseguró categoria_financiera en caja_salidas';
  end if;

  select count(*)
    into v_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'caja_cierres'
    and column_name in (
      'efectivo_vita_lima',
      'efectivo_propinas',
      'total_salidas_efectivo',
      'efectivo_a_retirar',
      'salidas_sin_metodo',
      'cierre_fisico_calculable'
    );

  if v_count <> 6 then
    raise exception '042 no agregó todas las columnas físicas de caja_cierres';
  end if;
end $$;

insert into public.caja_salidas (
  salida_id, fecha, hora, sede, tipo_gasto, concepto, monto,
  metodo_salida, categoria_financiera, responsable
)
values (
  'SAL-042-CASH', date '2026-09-18', time '18:00',
  'Miraflores', 'Insumos', 'QA efectivo', 20,
  'EFECTIVO', 'GASTO_OPERATIVO', 'QA'
);

insert into public.caja_salidas (
  salida_id, fecha, hora, sede, tipo_gasto, concepto, monto,
  metodo_salida, categoria_financiera, responsable
)
values (
  'SAL-042-YAPE', date '2026-09-18', time '18:05',
  'Miraflores', 'Servicios', 'QA digital', 30,
  'YAPE', 'GASTO_OPERATIVO', 'QA'
);

insert into public.caja_movimientos_fondos (
  movimiento_fondo_id, fecha, hora, sede, tipo_movimiento, metodo,
  concepto, monto, responsable
)
values (
  'FON-042-RETIRO', date '2026-09-18', time '18:10',
  'Miraflores', 'RETIRO_CAJA', 'EFECTIVO',
  'Retiro para depósito', 100, 'QA'
);

insert into public.caja_movimientos_fondos (
  movimiento_fondo_id, fecha, hora, sede, tipo_movimiento, metodo,
  concepto, monto, responsable
)
values (
  'FON-042-TRANSFER', date '2026-09-18', time '18:15',
  'Miraflores', 'TRANSFERENCIA', 'BCP',
  'Transferencia interna', 50, 'QA'
);

do $$
begin
  begin
    insert into public.caja_movimientos_fondos (
      movimiento_fondo_id, fecha, hora, sede, tipo_movimiento, metodo,
      concepto, monto
    )
    values (
      'FON-042-BAD-RETIRO', current_date, current_time,
      'Miraflores', 'RETIRO_CAJA', 'YAPE', 'inválido', 1
    );
    raise exception 'RETIRO_CAJA por YAPE debió fallar';
  exception
    when check_violation then null;
  end;

  begin
    insert into public.caja_movimientos_fondos (
      movimiento_fondo_id, fecha, hora, sede, tipo_movimiento, metodo,
      concepto, monto
    )
    values (
      'FON-042-BAD-TRANSFER', current_date, current_time,
      'Miraflores', 'TRANSFERENCIA', 'EFECTIVO', 'inválido', 1
    );
    raise exception 'TRANSFERENCIA por EFECTIVO debió fallar';
  exception
    when check_violation then null;
  end;

  begin
    insert into public.caja_salidas (
      salida_id, fecha, hora, sede, tipo_gasto, concepto, monto,
      metodo_salida
    )
    values (
      'SAL-042-BAD-METHOD', current_date, current_time,
      'Miraflores', 'Otro', 'inválido', 1, 'BITCOIN'
    );
    raise exception 'metodo_salida fuera de catálogo debió fallar';
  exception
    when check_violation then null;
  end;
end $$;

do $$
declare
  v_gastos numeric;
  v_fondos numeric;
begin
  select coalesce(sum(monto), 0)
    into v_gastos
  from public.caja_salidas
  where salida_id like 'SAL-042-%';

  select coalesce(sum(monto), 0)
    into v_fondos
  from public.caja_movimientos_fondos
  where movimiento_fondo_id like 'FON-042-%';

  if v_gastos <> 50 then
    raise exception 'gastos QA esperados 50, recibido %', v_gastos;
  end if;

  if v_fondos <> 150 then
    raise exception 'movimientos de fondos QA esperados 150, recibido %', v_fondos;
  end if;
end $$;


insert into public.caja_cierres (
  cierre_id, fecha, sede, estado
)
values (
  'CIE-042-ONE', date '2026-09-18', 'Miraflores', 'CERRADO'
);

do $$
begin
  begin
    insert into public.caja_cierres (
      cierre_id, fecha, sede, estado
    )
    values (
      'CIE-042-DUP', date '2026-09-18', 'Miraflores', 'CERRADO'
    );
    raise exception 'el índice único debió impedir un segundo cierre CERRADO';
  exception
    when unique_violation then null;
  end;
end $$;

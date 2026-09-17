-- ============================================================
-- Caja Vita Lima — Carga inicial de horarios septiembre 2026
-- Migración 033
-- Requiere: 031_terapistas_horario_habitual.sql
--           032_terapistas_horario_excepciones.sql
-- Fuente: horario operativo de septiembre 2026 compartido por coordinación.
-- ============================================================

-- Horario habitual base:
-- Allison: 11:00–20:00 todos los días.
-- Marivel: 15:00–20:00 todos los días.
-- Los descansos rotativos de septiembre se guardan como excepciones por fecha.

update public.terapista_horario_habitual h
set
  trabaja = true,
  hora_inicio = time '11:00',
  hora_fin = time '20:00',
  sede = null,
  observacion = null,
  updated_at = now()
from public.terapistas t
where t.terapista_id = h.terapista_id
  and t.nombre = 'Allison';

update public.terapista_horario_habitual h
set
  trabaja = true,
  hora_inicio = time '15:00',
  hora_fin = time '20:00',
  sede = null,
  observacion = null,
  updated_at = now()
from public.terapistas t
where t.terapista_id = h.terapista_id
  and t.nombre = 'Marivel';

-- Descansos de Allison en septiembre 2026: 1, 7, 18 y 27.
insert into public.terapista_horario_excepciones (
  terapista_id,
  fecha,
  tipo,
  trabaja,
  hora_inicio,
  hora_fin,
  sede,
  observacion
)
select
  t.terapista_id,
  d.fecha,
  'DESCANSO',
  false,
  null,
  null,
  null,
  'Carga inicial desde horario operativo septiembre 2026.'
from public.terapistas t
cross join (
  values
    (date '2026-09-01'),
    (date '2026-09-07'),
    (date '2026-09-18'),
    (date '2026-09-27')
) as d(fecha)
where t.nombre = 'Allison'
on conflict (terapista_id, fecha) do update
set
  tipo = excluded.tipo,
  trabaja = excluded.trabaja,
  hora_inicio = excluded.hora_inicio,
  hora_fin = excluded.hora_fin,
  sede = excluded.sede,
  observacion = excluded.observacion,
  updated_at = now();

-- Descansos de Marivel en septiembre 2026: 2, 6, 7, 11, 14, 18, 20, 21, 23 y 28.
insert into public.terapista_horario_excepciones (
  terapista_id,
  fecha,
  tipo,
  trabaja,
  hora_inicio,
  hora_fin,
  sede,
  observacion
)
select
  t.terapista_id,
  d.fecha,
  'DESCANSO',
  false,
  null,
  null,
  null,
  'Carga inicial desde horario operativo septiembre 2026.'
from public.terapistas t
cross join (
  values
    (date '2026-09-02'),
    (date '2026-09-06'),
    (date '2026-09-07'),
    (date '2026-09-11'),
    (date '2026-09-14'),
    (date '2026-09-18'),
    (date '2026-09-20'),
    (date '2026-09-21'),
    (date '2026-09-23'),
    (date '2026-09-28')
) as d(fecha)
where t.nombre = 'Marivel'
on conflict (terapista_id, fecha) do update
set
  tipo = excluded.tipo,
  trabaja = excluded.trabaja,
  hora_inicio = excluded.hora_inicio,
  hora_fin = excluded.hora_fin,
  sede = excluded.sede,
  observacion = excluded.observacion,
  updated_at = now();

-- Validación sugerida post-migración:
-- select t.nombre, h.dia_semana, h.trabaja, h.hora_inicio, h.hora_fin
-- from public.terapista_horario_habitual h
-- join public.terapistas t on t.terapista_id = h.terapista_id
-- where t.nombre in ('Allison','Marivel')
-- order by t.nombre, h.dia_semana;
--
-- select t.nombre, e.fecha, e.tipo, e.trabaja
-- from public.terapista_horario_excepciones e
-- join public.terapistas t on t.terapista_id = e.terapista_id
-- where e.fecha between date '2026-09-01' and date '2026-09-30'
-- order by e.fecha, t.nombre;

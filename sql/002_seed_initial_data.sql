-- ============================================================
-- Caja Vita Lima — Supabase SQL v2
-- Archivo: sql/002_seed_initial_data.sql
-- Objetivo:
--   Cargar datos base iniciales para la nueva Caja Vita Lima.
--
-- Importante:
--   - Este seed es para configuración inicial y pruebas.
--   - No usar PINs reales definitivos en producción.
--   - Más adelante el login debería pasar a Supabase Auth o a un
--     módulo seguro con roles y políticas RLS.
-- ============================================================

-- ============================================================
-- 1) CONFIG_LISTAS
-- Equivalente a la hoja CONFIG_LISTAS de Apps Script.
-- ============================================================

delete from public.config_listas
where lista in (
  'SEDES',
  'METODOS_PAGO',
  'TERAPISTAS',
  'ESTADO_BOLETA',
  'RESPONSABLES',
  'TIPOS_GASTO',
  'PLATAFORMAS_CONVENIO',
  'SERVICIOS',
  'ROLES'
);

insert into public.config_listas (lista, valor, orden, activo, alias_de, nota) values

-- SEDES
('SEDES', 'Miraflores', 1, true, null, 'Sede Vita Lima'),
('SEDES', 'San Borja', 2, true, null, 'Sede Vita Lima'),

-- MÉTODOS DE PAGO
('METODOS_PAGO', 'EFECTIVO', 1, true, null, 'Pago en efectivo'),
('METODOS_PAGO', 'YAPE', 2, true, null, 'Billetera digital'),
('METODOS_PAGO', 'PLIN', 3, true, null, 'Billetera digital'),
('METODOS_PAGO', 'BCP', 4, true, null, 'Transferencia bancaria'),
('METODOS_PAGO', 'INTERBANK', 5, true, null, 'Transferencia bancaria'),
('METODOS_PAGO', 'SCOTIABANK', 6, true, null, 'Transferencia bancaria'),
('METODOS_PAGO', 'BBVA', 7, true, null, 'Transferencia bancaria'),
('METODOS_PAGO', 'IZIPAY POS', 8, true, null, 'POS / tarjeta'),
('METODOS_PAGO', 'LINK IZIPAY', 9, true, null, 'Link de pago Izipay'),
('METODOS_PAGO', 'OTRO', 10, true, null, 'Otro método de pago'),

-- TERAPISTAS
('TERAPISTAS', 'Rossana', 1, true, null, null),
('TERAPISTAS', 'Maria E', 2, true, null, null),
('TERAPISTAS', 'Melissa', 3, true, null, null),
('TERAPISTAS', 'J.Pilar', 4, true, null, null),
('TERAPISTAS', 'Cecilia', 5, true, null, null),
('TERAPISTAS', 'Cynthia', 6, true, null, null),
('TERAPISTAS', 'Lucia', 7, true, null, null),
('TERAPISTAS', 'Milagritos', 8, true, null, null),
('TERAPISTAS', 'Lusy', 9, true, null, null),
('TERAPISTAS', 'Alison', 10, true, null, null),
('TERAPISTAS', 'Miriam', 11, true, null, null),
('TERAPISTAS', 'Danitza', 12, true, null, null),
('TERAPISTAS', 'Sheyla', 13, true, null, null),
('TERAPISTAS', 'Apoyo', 14, true, null, null),
('TERAPISTAS', 'Therapy', 15, true, null, null),
('TERAPISTAS', 'Luis', 16, true, null, null),
('TERAPISTAS', 'Otro', 17, true, null, 'Permite registrar terapista manual'),

-- ESTADOS DE BOLETA
('ESTADO_BOLETA', 'Emitida', 1, true, null, null),
('ESTADO_BOLETA', 'Pendiente', 2, true, null, null),
('ESTADO_BOLETA', 'No aplica', 3, true, null, null),
('ESTADO_BOLETA', 'Anulada', 4, true, null, null),

-- RESPONSABLES
('RESPONSABLES', 'Gerald', 1, true, null, null),
('RESPONSABLES', 'Luis', 2, true, null, null),
('RESPONSABLES', 'Naty', 3, true, null, null),
('RESPONSABLES', 'Nataly', 4, true, null, null),
('RESPONSABLES', 'Otro', 5, true, null, null),

-- TIPOS DE GASTO / SALIDAS
('TIPOS_GASTO', 'Lavandería', 1, true, null, null),
('TIPOS_GASTO', 'Insumos', 2, true, null, null),
('TIPOS_GASTO', 'Agua', 3, true, null, null),
('TIPOS_GASTO', 'Pasaje', 4, true, null, null),
('TIPOS_GASTO', 'Pago personal', 5, true, null, null),
('TIPOS_GASTO', 'Reparación', 6, true, null, null),
('TIPOS_GASTO', 'Depósitos', 7, true, null, null),
('TIPOS_GASTO', 'Propina', 8, true, null, null),
('TIPOS_GASTO', 'Otros', 9, true, null, null),

-- PLATAFORMAS / CONVENIOS
('PLATAFORMAS_CONVENIO', 'Cuponidad', 1, true, null, null),
('PLATAFORMAS_CONVENIO', 'Bee Beneficios', 2, true, null, null),
('PLATAFORMAS_CONVENIO', 'Convenio', 3, true, null, null),
('PLATAFORMAS_CONVENIO', 'Otro', 4, true, null, null),

-- SERVICIOS BASE
('SERVICIOS', 'Masaje relajante', 1, true, null, null),
('SERVICIOS', 'Masaje descontracturante', 2, true, null, null),
('SERVICIOS', 'Masaje terapéutico 60 min', 3, true, null, null),
('SERVICIOS', 'Personalizado', 4, true, null, null),
('SERVICIOS', 'Gift Card', 5, true, null, null),
('SERVICIOS', 'Cuponidad', 6, true, null, null),
('SERVICIOS', 'Bee Beneficios', 7, true, null, null),

-- ROLES DE LA NUEVA APP
('ROLES', 'ADMIN_GERALD', 1, true, null, 'Administra sistema, código, despliegue e integraciones'),
('ROLES', 'CAJA', 2, true, null, 'Registra atenciones, pagos, boletas, salidas y cierres'),
('ROLES', 'FINANZAS', 3, true, null, 'Consulta dashboard y exporta reportes financieros'),
('ROLES', 'LECTURA', 4, true, null, 'Consulta información autorizada sin edición crítica');


-- ============================================================
-- 2) USUARIOS INICIALES
-- Equivalente inicial a la hoja USUARIOS.
--
-- Nota:
--   Estos PINs son temporales para pruebas internas.
--   Cambiarlos antes de usar en producción real.
-- ============================================================

insert into public.usuarios (usuario, pin, rol, nombre, activo, nota) values
('gerald', 'CAMBIAR_PIN', 'ADMIN_GERALD', 'Gerald', true, 'Administrador técnico y operativo'),
('luis', 'CAMBIAR_PIN', 'CAJA', 'Luis', true, 'Caja / pagos'),
('naty', 'CAMBIAR_PIN', 'CAJA', 'Naty', true, 'Citas / atención'),
('socio', 'CAMBIAR_PIN', 'FINANZAS', 'Socio', true, 'Dashboard financiero y reportes')
on conflict (usuario) do update set
  pin = excluded.pin,
  rol = excluded.rol,
  nombre = excluded.nombre,
  activo = excluded.activo,
  nota = excluded.nota;


-- ============================================================
-- 3) VALIDACIÓN RÁPIDA
-- Puedes ejecutar estas consultas después del seed para revisar.
-- ============================================================

select 'config_listas' as tabla, count(*) as total from public.config_listas
union all
select 'usuarios' as tabla, count(*) as total from public.usuarios;

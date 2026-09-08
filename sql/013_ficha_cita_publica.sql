-- ============================================================
-- Caja Vita Lima — Supabase SQL v13
-- Archivo: sql/013_ficha_cita_publica.sql
-- Objetivo:
--   Soportar la ficha de cita pública: el enlace que recibe el
--   cliente tras pagar el adelanto, para completar sus datos, la
--   ficha de salud y sus consentimientos desde la web pública
--   (vita-lima-web, PR #38, docs/encargo-web-ficha-cita.md).
--
-- Referencia: docs/caja-cambios-para-la-ficha-de-cita.md
--   (secciones 2, 6 y 7 de ese documento)
--
-- IMPORTANTE — ACCIÓN MANUAL REQUERIDA:
--   Igual que 012_login_intentos.sql, este script NO se ha ejecutado
--   contra Supabase. Debe revisarse y correrse manualmente en el
--   editor SQL de Supabase antes de desplegar
--   app/api/publico/ficha/[token]/route.ts.
--
-- Estilo:
--   Sin RLS y sin foreign keys, igual que el resto del esquema
--   (001-012): el acceso se controla en la capa de aplicación con la
--   service role key (lib/supabaseServer.ts), y las referencias entre
--   tablas son texto simple (reserva_id, cliente_id), no FKs.
--
-- Orden de ejecución (tres partes separadas a propósito):
--   PARTE 0 — Pre-chequeos. Correr cada consulta POR SEPARADO antes
--             de tocar nada. Si alguna devuelve filas, resolverlas a
--             mano (fusionar clientes duplicados, corregir cupones
--             repetidos, confirmar nombres de sede) ANTES de seguir.
--   PARTE 1 — La migración en sí. Pensada para correrse como un solo
--             bloque, de principio a fin, en el editor SQL de
--             Supabase. Es re-ejecutable: si se corta a mitad (error,
--             timeout, cierre del editor) y se vuelve a correr desde
--             el principio, no falla por "already exists" — todo usa
--             `if not exists` o un `drop ... if exists` previo.
--   PARTE 2 — Validación posterior. Cada SELECT es independiente:
--             correrlos uno por uno, no todos juntos — si se corren
--             de un tirón en el editor de Supabase, solo se ve el
--             resultado del último.
-- ============================================================


-- ============================================================
-- PARTE 0 — PRE-CHEQUEOS (correr antes de la Parte 1, uno por uno)
-- ============================================================

-- ------------------------------------------------------------
-- 0.1) Duplicados de whatsapp por E.164
--
-- La misma normalización que va a aplicar el UPDATE de la Parte 1
-- (paso 3), no los dígitos crudos: "987654321" y "+51987654321" son
-- la misma persona y normalizan al mismo E.164, aunque sus dígitos
-- crudos sean distintos. Si esta consulta devuelve filas, hay que
-- decidir a mano cuál `cliente_id` es el bueno (fusionar los otros o
-- vaciarles el whatsapp) ANTES de correr la Parte 1: si no, el UPDATE
-- del backfill choca contra el índice único que se crea después.
-- ------------------------------------------------------------

with norm as (
  select cliente_id, cliente, whatsapp,
    case
      when whatsapp is null or btrim(whatsapp) = '' then null
      when btrim(whatsapp) like '+%'
        and length(regexp_replace(whatsapp, '\D', '', 'g')) between 8 and 15
        then '+' || regexp_replace(whatsapp, '\D', '', 'g')
      when regexp_replace(whatsapp, '\D', '', 'g') ~ '^9\d{8}$'
        then '+51' || regexp_replace(whatsapp, '\D', '', 'g')
      when regexp_replace(whatsapp, '\D', '', 'g') ~ '^519\d{8}$'
        then '+' || regexp_replace(whatsapp, '\D', '', 'g')
      else null
    end as e164
  from public.clientes
)
select e164, count(*) as total, array_agg(cliente_id) as cliente_ids, array_agg(cliente) as nombres
from norm
where e164 is not null
group by e164
having count(*) > 1;

-- ------------------------------------------------------------
-- 0.2) Duplicados de cupón por (plataforma, codigo_cupon)
--
-- El índice único de la Parte 1 (paso 5) los rechazaría igual, pero
-- es mejor saberlo antes: decidir a mano cuál fila es la real.
-- ------------------------------------------------------------

select plataforma, codigo_cupon, count(*)
from public.cupones_convenios
where codigo_cupon is not null and btrim(codigo_cupon) <> ''
group by 1, 2
having count(*) > 1;

-- ------------------------------------------------------------
-- 0.3) Nombres de sede reales
--
-- La Parte 1 (paso 7) siembra `sedes` con 'San Borja' y 'Miraflores'
-- — los mismos nombres que ya siembra config_listas desde
-- 001_create_tables.sql. Pero el cruce en el GET de la sección 6 es
-- por `citas_reservadas.sede = sedes.nombre` (texto exacto), así que
-- hay que confirmar que son los mismos literales que trae la
-- operación real, no solo los del seed original. Si esta consulta
-- trae algo distinto de 'San Borja' / 'Miraflores' (mayúsculas,
-- tildes, espacios, un nombre de sede que ya no se usa, etc.), avisar
-- antes de correr el INSERT del paso 7.
-- ------------------------------------------------------------

select distinct sede
from public.citas_reservadas
order by 1;


-- ============================================================
-- PARTE 1 — MIGRACIÓN (correr como un solo bloque)
-- ============================================================


-- ============================================================
-- 1) CITAS_RESERVADAS — columnas nuevas
--
-- Nota: calendar_event_id NO se agrega aquí — ya existe desde
-- 001_create_tables.sql. El documento lo lista en su tabla de la
-- sección 2 pero es una columna que ya está modelada.
-- ============================================================

alter table public.citas_reservadas
  add column if not exists token_ficha text,
  add column if not exists token_expira timestamptz,
  add column if not exists estado_ficha text default 'pendiente',
  add column if not exists canal text default 'directo',
  add column if not exists requiere_confirmacion boolean default false,
  add column if not exists confirmado_en timestamptz,
  add column if not exists personas smallint default 1,
  add column if not exists idioma text default 'es',
  add column if not exists duracion_min integer,
  add column if not exists terapista_preferida text,
  add column if not exists cupon_vigente_hasta timestamptz;

-- `cupon_vigente_hasta` va acá y NO en cupones_convenios: el GET de
-- la sección 6 necesita `cupon.vigenteHasta` antes de que el cliente
-- escriba el código del cupón, o sea antes de que exista la fila en
-- cupones_convenios. Es una propiedad de la promoción que el equipo
-- elige al armar la cita, no del cupón que el cliente declara
-- después. Ver sección 2 del documento (nota agregada tras revisión
-- del dueño).

-- Único y disperso: muchas citas antiguas no tendrán token nunca
-- (se crearon antes de este cambio, o son del flujo directo sin
-- ficha pública), así que el índice único debe ignorar los NULL.
create unique index if not exists uq_citas_token_ficha
  on public.citas_reservadas (token_ficha)
  where token_ficha is not null;

create index if not exists idx_citas_estado_ficha
  on public.citas_reservadas (estado_ficha);

create index if not exists idx_citas_requiere_confirmacion
  on public.citas_reservadas (requiere_confirmacion)
  where requiere_confirmacion = true and confirmado_en is null;

create index if not exists idx_citas_canal
  on public.citas_reservadas (canal);

-- `add constraint` no soporta `if not exists` en Postgres — este
-- script se corre a mano en el editor de Supabase, donde reintentar
-- tras un corte a mitad es lo normal. Por eso cada constraint lleva
-- su `drop ... if exists` antes, para que sea re-ejecutable.

alter table public.citas_reservadas drop constraint if exists chk_citas_estado_ficha;
alter table public.citas_reservadas
  add constraint chk_citas_estado_ficha
    check (estado_ficha in ('pendiente', 'completa'));

alter table public.citas_reservadas drop constraint if exists chk_citas_canal;
alter table public.citas_reservadas
  add constraint chk_citas_canal
    check (canal in ('directo', 'cuponidad', 'bee'));

alter table public.citas_reservadas drop constraint if exists chk_citas_idioma;
alter table public.citas_reservadas
  add constraint chk_citas_idioma
    check (idioma in ('es', 'en'));


-- ============================================================
-- 2) CAJA_PAGOS — columna nueva
--
-- La sección 3 del documento: al registrar el pago se anota monto,
-- método y número de operación — ese número es lo que después deja
-- cuadrar caja sin abrir el chat. Faltaba la columna.
-- ============================================================

alter table public.caja_pagos
  add column if not exists numero_operacion text;


-- ============================================================
-- 3) CLIENTES — columnas nuevas
-- ============================================================

alter table public.clientes
  add column if not exists whatsapp_e164 text,
  add column if not exists pais_telefono text,
  add column if not exists idioma text,
  add column if not exists cumple_dia smallint,
  add column if not exists cumple_mes smallint,
  add column if not exists consent_datos_en timestamptz,
  add column if not exists consent_promos_en timestamptz;

alter table public.clientes drop constraint if exists chk_clientes_idioma;
alter table public.clientes
  add constraint chk_clientes_idioma
    check (idioma is null or idioma in ('es', 'en'));

alter table public.clientes drop constraint if exists chk_clientes_cumple_dia;
alter table public.clientes
  add constraint chk_clientes_cumple_dia
    check (cumple_dia is null or cumple_dia between 1 and 31);

alter table public.clientes drop constraint if exists chk_clientes_cumple_mes;
alter table public.clientes
  add constraint chk_clientes_cumple_mes
    check (cumple_mes is null or cumple_mes between 1 and 12);

-- ------------------------------------------------------------
-- Backfill: whatsapp -> whatsapp_e164
--
-- Asume Perú (+51) donde el número no trae prefijo de país.
-- Reglas, en orden:
--   a) ya viene con '+'                       -> se limpia y se deja tal cual
--   b) 9 dígitos empezando en 9 (celular PE)   -> +51 + número
--   c) 11 dígitos empezando en '51'            -> '+' + número
--   d) cualquier otra cosa                     -> se deja NULL para revisión
--      manual (ver Parte 2)
--
-- El índice único de whatsapp_e164 se crea DESPUÉS de este backfill
-- (más abajo), no antes: si a la consulta 0.1 se le escapó algún
-- duplicado, tiene que fallar acá, con el error señalando la fila
-- exacta del UPDATE — no a mitad de un UPDATE masivo sobre una tabla
-- ya con el índice puesto.
-- ------------------------------------------------------------

update public.clientes
set
  whatsapp_e164 = case
    when whatsapp is null or btrim(whatsapp) = '' then null
    when btrim(whatsapp) like '+%'
      and length(regexp_replace(whatsapp, '\D', '', 'g')) between 8 and 15
      then '+' || regexp_replace(whatsapp, '\D', '', 'g')
    when regexp_replace(whatsapp, '\D', '', 'g') ~ '^9\d{8}$'
      then '+51' || regexp_replace(whatsapp, '\D', '', 'g')
    when regexp_replace(whatsapp, '\D', '', 'g') ~ '^519\d{8}$'
      then '+' || regexp_replace(whatsapp, '\D', '', 'g')
    else null
  end,
  pais_telefono = case
    when whatsapp is null or btrim(whatsapp) = '' then null
    when btrim(whatsapp) like '+%'
      and length(regexp_replace(whatsapp, '\D', '', 'g')) between 8 and 15
      then null -- país desconocido para prefijos que no son Perú; revisar a mano
    when regexp_replace(whatsapp, '\D', '', 'g') ~ '^9\d{8}$'
      then 'PE'
    when regexp_replace(whatsapp, '\D', '', 'g') ~ '^519\d{8}$'
      then 'PE'
    else null
  end
where whatsapp_e164 is null;

-- Índice único, DESPUÉS del backfill (bloqueante corregido).
create unique index if not exists uq_clientes_whatsapp_e164
  on public.clientes (whatsapp_e164)
  where whatsapp_e164 is not null;


-- ============================================================
-- 4) FICHAS_SALUD — tabla nueva
--
-- Separada de clientes/citas a propósito (dato sensible de
-- categoría especial). Sin FK explícita a citas_reservadas ni a
-- clientes, siguiendo el estilo del resto del esquema; reserva_id y
-- cliente_id son texto simple.
--
-- Acceso: decisión del dueño (sección 1/2 del documento, revisada) —
-- sin restricción por rol. La ven ADMIN_GERALD, SOCIO y
-- VITA_OPERACION (los tres roles reales de lib/auth.ts): los socios
-- ven todo el negocio, y VITA_OPERACION es quien atiende y necesita
-- saber si hay embarazo o presión alta antes de tocar a la clienta.
-- No hay RLS en este proyecto (todo el backend usa la service role
-- key), así que esto no cambia nada en SQL — solo importa que la
-- futura pantalla interna que lea esta tabla no le agregue una
-- restricción que el negocio no pidió.
--
-- Si el cliente marca "Ninguna de las anteriores" en el bloque de
-- salud, NO se crea fila acá (decisión del dueño, anotada en el
-- documento): sin fila = sin condiciones declaradas. La aplicación
-- (app/api/publico/ficha/[token]/route.ts) es la que decide si
-- inserta o no; esta tabla no fuerza una fila por reserva.
-- ============================================================

create table if not exists public.fichas_salud (
  ficha_id text primary key,
  reserva_id text not null,
  cliente_id text not null,
  embarazo boolean default false,
  presion boolean default false,
  cirugia_reciente boolean default false,
  alergias text,
  zonas_evitar text,
  notas text,
  consent_salud_en timestamptz,
  creado_en timestamptz default now()
);

create index if not exists idx_fichas_salud_reserva_id
  on public.fichas_salud (reserva_id);

create index if not exists idx_fichas_salud_cliente_id
  on public.fichas_salud (cliente_id);

-- A lo más una ficha de salud por cita (si la web reintenta el POST,
-- se hace upsert por reserva_id, no un insert duplicado).
create unique index if not exists uq_fichas_salud_reserva_id
  on public.fichas_salud (reserva_id);


-- ============================================================
-- 5) CUPONES_CONVENIOS — columnas nuevas
-- ============================================================

alter table public.cupones_convenios
  add column if not exists estado text default 'declarado',
  add column if not exists reserva_id text;

-- Sin `vigente_hasta` acá a propósito: esa fecha vive en
-- citas_reservadas.cupon_vigente_hasta (ver paso 1), porque el GET
-- de la sección 6 la necesita antes de que exista esta fila.

alter table public.cupones_convenios drop constraint if exists chk_cupones_estado;
alter table public.cupones_convenios
  add constraint chk_cupones_estado
    check (estado in ('declarado', 'verificado', 'canjeado'));

create index if not exists idx_cupones_estado
  on public.cupones_convenios (estado);

create index if not exists idx_cupones_reserva_id
  on public.cupones_convenios (reserva_id);

-- Restricción única real que pide la sección 2: corta el reenvío
-- del mismo cupón. Dispersa (ignora codigo_cupon vacío/NULL) porque
-- hay filas históricas sin código. Si el pre-chequeo 0.2 encontró
-- duplicados, resolverlos a mano antes de llegar acá.
create unique index if not exists uq_cupones_plataforma_codigo
  on public.cupones_convenios (plataforma, codigo_cupon)
  where codigo_cupon is not null and btrim(codigo_cupon) <> '';


-- ============================================================
-- 6) BENEFICIOS — tabla nueva (se deja creada; se usa recién en
--    la etapa 4, sección 5 del documento)
-- ============================================================

create table if not exists public.beneficios (
  beneficio_id text primary key,
  whatsapp_e164 text not null,
  tipo text not null,
  emitido_en timestamptz default now(),
  vence_el timestamptz not null,
  estado text default 'disponible',
  reserva_id_canje text
);

alter table public.beneficios drop constraint if exists chk_beneficios_tipo;
alter table public.beneficios
  add constraint chk_beneficios_tipo
    check (tipo in ('REACT-10', 'REACT-MIN'));

alter table public.beneficios drop constraint if exists chk_beneficios_estado;
alter table public.beneficios
  add constraint chk_beneficios_estado
    check (estado in ('disponible', 'reservado', 'canjeado'));

create index if not exists idx_beneficios_whatsapp_e164
  on public.beneficios (whatsapp_e164);

create index if not exists idx_beneficios_estado
  on public.beneficios (estado);


-- ============================================================
-- 7) SEDES — tabla nueva
--
-- No estaba en el plan original de la sección 2 del documento, pero
-- hoy no hay ningún lugar en el esquema con la dirección o el enlace
-- de Maps de una sede (config_listas solo guarda el nombre). El GET
-- de la sección 6 del documento necesita sedeDireccion/sedeMapsUrl,
-- y la pantalla interna (§3) va a necesitar además el horario real.
--
-- Confirmado por el dueño: 'San Borja' y 'Miraflores' son los nombres
-- reales que usa citas_reservadas.sede (consulta 0.3). Direcciones,
-- maps_url y horario vienen de content/locations.ts del repo
-- vita-lima-web — no son un placeholder.
--
-- Nota sobre el horario de San Borja: locations.ts lo describe como
-- "principalmente de 3 a 8 p.m." — el "principalmente" no cabe en
-- una columna `time`, así que queda 15:00–20:00 y se ajusta a mano
-- si en la práctica hay excepciones. Estos horarios son los que la
-- pantalla interna (§3) tiene que usar para filtrar las horas que
-- ofrece — hoy no existe ese filtro, por eso hoy se puede pedir una
-- cita a las 11 a.m. en San Borja aunque abra a las 3 p.m.
-- ============================================================

create table if not exists public.sedes (
  sede_id text primary key,
  nombre text unique not null,
  direccion text,
  maps_url text,
  hora_apertura time,
  hora_cierre time,
  activo boolean default true
);

insert into public.sedes (sede_id, nombre)
values
  ('SEDE-SAN-BORJA', 'San Borja'),
  ('SEDE-MIRAFLORES', 'Miraflores')
on conflict (nombre) do nothing;

update public.sedes set
  direccion = 'Av. Aviación 3358, oficina 204, San Borja, Lima',
  maps_url = 'https://maps.app.goo.gl/hsbjqCdx8xJdRRTZ7',
  hora_apertura = '15:00',
  hora_cierre = '20:00'
where sede_id = 'SEDE-SAN-BORJA';

update public.sedes set
  direccion = 'Av. Larco 812, oficina 306, Miraflores, Lima',
  maps_url = 'https://maps.app.goo.gl/ABS3bhqTzbP1ZTnP9',
  hora_apertura = '11:00',
  hora_cierre = '20:00'
where sede_id = 'SEDE-MIRAFLORES';


-- ============================================================
-- 8) FICHA_PUBLICA_INTENTOS — límite de intentos por IP
--
-- Mismo patrón que 012_login_intentos.sql, aplicado al endpoint
-- público GET/POST /api/publico/ficha/:token (sección 7 del
-- documento: "Límite de intentos por IP en el endpoint público").
-- También protege GET /api/publico/ficha/:token/ics, que no lleva
-- X-Caja-Secret (lo abre directo el navegador del cliente).
-- Clave compuesta ip+token: un token inválido probado desde muchas
-- IPs no debe poder esquivar el límite, y una IP que prueba muchos
-- tokens tampoco.
-- ============================================================

create table if not exists public.ficha_publica_intentos (
  ip text not null,
  token text not null,
  intentos int not null default 0,
  bloqueado_hasta timestamptz,
  ultimo_intento timestamptz,
  primary key (ip, token)
);

create index if not exists idx_ficha_publica_intentos_bloqueado
  on public.ficha_publica_intentos (bloqueado_hasta);


-- ============================================================
-- PARTE 2 — VALIDACIÓN (correr cada SELECT por separado)
-- ============================================================

-- ------------------------------------------------------------
-- 2.1) Conteo rápido por tabla/columna
-- ------------------------------------------------------------

select 'citas_reservadas.token_ficha' as columna,
  count(*) filter (where token_ficha is not null) as con_valor,
  count(*) as total
from public.citas_reservadas
union all
select 'clientes.whatsapp_e164', count(*) filter (where whatsapp_e164 is not null), count(*)
from public.clientes
union all
select 'fichas_salud', count(*), count(*)
from public.fichas_salud
union all
select 'beneficios', count(*), count(*)
from public.beneficios
union all
select 'sedes.direccion', count(*) filter (where direccion is not null), count(*)
from public.sedes
union all
select 'cupones_convenios.estado', count(*) filter (where estado is not null), count(*)
from public.cupones_convenios
union all
select 'caja_pagos.numero_operacion', count(*) filter (where numero_operacion is not null), count(*)
from public.caja_pagos;

-- ------------------------------------------------------------
-- 2.2) Clientes cuyo whatsapp NO se pudo normalizar a E.164
-- (revisar a mano, como pide la sección 2 del documento)
-- ------------------------------------------------------------

select cliente_id, cliente, whatsapp
from public.clientes
where whatsapp is not null
  and btrim(whatsapp) <> ''
  and whatsapp_e164 is null
order by cliente_id;

-- ------------------------------------------------------------
-- 2.3) Clientes que SÍ normalizaron pero quedaron sin país
-- (venían con '+' de un prefijo que la regla de Perú no reconoce;
-- nadie los estaba listando hasta ahora)
-- ------------------------------------------------------------

select cliente_id, cliente, whatsapp, whatsapp_e164
from public.clientes
where whatsapp_e164 is not null
  and pais_telefono is null
order by cliente_id;

-- ============================================================
-- FIN DEL SCRIPT
-- ============================================================

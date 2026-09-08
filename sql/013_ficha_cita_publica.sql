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

alter table public.citas_reservadas
  add constraint chk_citas_estado_ficha
    check (estado_ficha in ('pendiente', 'completa'));

alter table public.citas_reservadas
  add constraint chk_citas_canal
    check (canal in ('directo', 'cuponidad', 'bee'));

alter table public.citas_reservadas
  add constraint chk_citas_idioma
    check (idioma in ('es', 'en'));


-- ============================================================
-- 2) CLIENTES — columnas nuevas
-- ============================================================

alter table public.clientes
  add column if not exists whatsapp_e164 text,
  add column if not exists pais_telefono text,
  add column if not exists idioma text,
  add column if not exists cumple_dia smallint,
  add column if not exists cumple_mes smallint,
  add column if not exists consent_datos_en timestamptz,
  add column if not exists consent_promos_en timestamptz;

create unique index if not exists uq_clientes_whatsapp_e164
  on public.clientes (whatsapp_e164)
  where whatsapp_e164 is not null;

alter table public.clientes
  add constraint chk_clientes_idioma
    check (idioma is null or idioma in ('es', 'en'));

alter table public.clientes
  add constraint chk_clientes_cumple_dia
    check (cumple_dia is null or cumple_dia between 1 and 31);

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
--      manual (ver consulta de abajo)
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

-- Por si dos clientes distintos normalizan al mismo E.164 (duplicado
-- real en `whatsapp`, con o sin prefijo): el índice único de arriba
-- haría fallar el UPDATE. Antes de correr esta migración en Supabase,
-- correr esta consulta para detectarlos y decidir a mano cuál fila
-- es la buena:
--
-- select regexp_replace(whatsapp, '\D', '', 'g') as normalizado, count(*)
-- from public.clientes
-- where whatsapp is not null and btrim(whatsapp) <> ''
-- group by 1
-- having count(*) > 1;

-- ============================================================
-- 3) FICHAS_SALUD — tabla nueva
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

-- Una ficha de salud por cita (la POST de la sección 6 es de
-- una sola vez por token; si la web reintenta, se hace upsert por
-- reserva_id, no un insert duplicado).
create unique index if not exists uq_fichas_salud_reserva_id
  on public.fichas_salud (reserva_id);


-- ============================================================
-- 4) CUPONES_CONVENIOS — columnas nuevas
-- ============================================================

alter table public.cupones_convenios
  add column if not exists estado text default 'declarado',
  add column if not exists reserva_id text;

-- Sin `vigente_hasta` acá a propósito: esa fecha vive en
-- citas_reservadas.cupon_vigente_hasta (ver arriba), porque el GET
-- de la sección 6 la necesita antes de que exista esta fila.

alter table public.cupones_convenios
  add constraint chk_cupones_estado
    check (estado in ('declarado', 'verificado', 'canjeado'));

create index if not exists idx_cupones_estado
  on public.cupones_convenios (estado);

create index if not exists idx_cupones_reserva_id
  on public.cupones_convenios (reserva_id);

-- Restricción única real que pide la sección 2: corta el reenvío
-- del mismo cupón. Dispersa (ignora codigo_cupon vacío/NULL) porque
-- hay filas históricas sin código.
create unique index if not exists uq_cupones_plataforma_codigo
  on public.cupones_convenios (plataforma, codigo_cupon)
  where codigo_cupon is not null and btrim(codigo_cupon) <> '';

-- Antes de correr esto en Supabase, revisar duplicados existentes:
--
-- select plataforma, codigo_cupon, count(*)
-- from public.cupones_convenios
-- where codigo_cupon is not null and btrim(codigo_cupon) <> ''
-- group by 1, 2
-- having count(*) > 1;


-- ============================================================
-- 5) BENEFICIOS — tabla nueva (se deja creada; se usa recién en
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

alter table public.beneficios
  add constraint chk_beneficios_tipo
    check (tipo in ('REACT-10', 'REACT-MIN'));

alter table public.beneficios
  add constraint chk_beneficios_estado
    check (estado in ('disponible', 'reservado', 'canjeado'));

create index if not exists idx_beneficios_whatsapp_e164
  on public.beneficios (whatsapp_e164);

create index if not exists idx_beneficios_estado
  on public.beneficios (estado);


-- ============================================================
-- 6) SEDES — tabla nueva
--
-- No estaba en el plan original de la sección 2 del documento, pero
-- hoy no hay ningún lugar en el esquema con la dirección o el enlace
-- de Maps de una sede (config_listas solo guarda el nombre). El GET
-- de la sección 6 del documento necesita sedeDireccion/sedeMapsUrl,
-- y la pantalla interna (§3) va a necesitar además el horario real.
--
-- Se siembran las dos sedes conocidas (alineadas con
-- config_listas lista='SEDES') pero SIN datos todavía: direccion,
-- maps_url, hora_apertura y hora_cierre quedan en NULL. El dueño
-- pasa los valores reales aparte; mientras tanto el GET devuelve
-- sedeDireccion/sedeMapsUrl en null en vez de romper.
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
select * from (values
  ('SEDE-SAN-BORJA', 'San Borja'),
  ('SEDE-MIRAFLORES', 'Miraflores')
) as v(sede_id, nombre)
where not exists (
  select 1 from public.sedes where sedes.nombre = v.nombre
);


-- ============================================================
-- 7) FICHA_PUBLICA_INTENTOS — límite de intentos por IP
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
-- 8) Validación rápida
-- ============================================================

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
select 'sedes', count(*), count(*)
from public.sedes
union all
select 'cupones_convenios.estado', count(*) filter (where estado is not null), count(*)
from public.cupones_convenios;

-- Clientes cuyo whatsapp no se pudo normalizar a E.164 (revisar a mano,
-- como pide la sección 2 del documento):
select cliente_id, cliente, whatsapp
from public.clientes
where whatsapp is not null
  and btrim(whatsapp) <> ''
  and whatsapp_e164 is null
order by cliente_id;

-- ============================================================
-- FIN DEL SCRIPT
-- ============================================================

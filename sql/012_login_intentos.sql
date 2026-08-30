-- ============================================================
-- Caja Vita Lima — Supabase SQL v12
-- Archivo: sql/012_login_intentos.sql
-- Objetivo:
--   Soportar un límite de intentos fallidos de login con bloqueo
--   temporal (fuerza bruta contra el PIN), sin depender de memoria en
--   proceso: el proyecto corre en Vercel (serverless), así que el
--   conteo de intentos se persiste en esta tabla en vez de una
--   variable en memoria.
--
-- IMPORTANTE — ACCIÓN MANUAL REQUERIDA:
--   Este script debe ejecutarse manualmente en el editor SQL de
--   Supabase (o vía tu flujo habitual de migraciones) antes de que
--   app/actions.ts (loginAction) funcione: el código nuevo consulta y
--   escribe en public.login_intentos usando los mismos helpers REST
--   (supabaseSelectWhere / supabaseUpsert) que ya usa el resto del
--   proyecto, así que no se necesita ninguna función RPC adicional.
-- ============================================================


create table if not exists public.login_intentos (
  usuario text primary key,
  intentos_fallidos int not null default 0,
  bloqueado_hasta timestamptz,
  ultimo_intento timestamptz
);


create index if not exists idx_login_intentos_bloqueado_hasta
on public.login_intentos (bloqueado_hasta);


-- ============================================================
-- Validación rápida
-- ============================================================

select *
from public.login_intentos;

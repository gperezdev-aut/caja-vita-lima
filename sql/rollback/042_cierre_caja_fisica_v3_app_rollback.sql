-- Rollback seguro de compatibilidad para 042_cierre_caja_fisica_v3
--
-- USO:
--   Solo si se revierte la aplicación a la versión anterior después de haber
--   aplicado la migración 042.
--
-- OBJETIVO:
--   Restaurar la única incompatibilidad conductual con la app anterior:
--   el índice que impide dos cierres CERRADO para la misma fecha/sede.
--
-- IMPORTANTE:
--   NO elimina columnas ni caja_movimientos_fondos.
--   NO borra datos generados por V3.
--   La app anterior ignora esos objetos aditivos.
--
-- Si se necesita una reversión destructiva completa, seguir el runbook
-- RUNBOOK_ROLLOUT_CIERRE_CAJA_FISICA_V3.md y exportar primero cualquier dato
-- generado con V3.

begin;

drop index if exists public.uq_caja_cierres_fecha_sede_cerrado;

commit;

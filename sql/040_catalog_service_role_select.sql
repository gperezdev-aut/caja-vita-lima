-- 040_catalog_service_role_select.sql
-- Caja/Vercel consulta el catálogo canónico desde backend con service_role.
-- El rol necesita lectura explícita sobre las tablas/vista del catálogo.

grant select on table public.caja_catalog_releases to service_role;
grant select on table public.caja_catalog_services to service_role;
grant select on table public.caja_catalog_home_policy to service_role;
grant select on table public.caja_catalog_active_services_legacy_shape_v1 to service_role;

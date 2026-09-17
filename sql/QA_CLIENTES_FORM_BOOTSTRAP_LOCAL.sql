-- Bootstrap local efímero para QA de 034-038.
-- SOLO para PostgreSQL temporal/local. No aplicar en Supabase productivo.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END
$$;

create table if not exists public.clientes (
  cliente_id text primary key,
  cliente text,
  whatsapp text,
  dni text,
  email text,
  ultima_sede text,
  ultima_visita date,
  ultimo_servicio text,
  notas text,
  origen text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  total_reservas integer default 0,
  primera_reserva date,
  ultima_reserva date,
  cliente_potencial text,
  segmento_cliente text,
  telefono_alternativo text,
  etiquetas_crm text,
  preferencias_atencion text,
  alerta_atencion text,
  fecha_nacimiento date,
  consentimiento_whatsapp boolean default false,
  whatsapp_e164 text,
  pais_telefono text,
  idioma text,
  cumple_dia smallint,
  cumple_mes smallint,
  consent_datos_en timestamptz,
  consent_promos_en timestamptz,
  telefono_estado text,
  telefono_normalizacion_origen text,
  telefono_normalizado_en timestamptz,
  constraint chk_clientes_cumple_dia check (cumple_dia is null or cumple_dia between 1 and 31),
  constraint chk_clientes_cumple_mes check (cumple_mes is null or cumple_mes between 1 and 12),
  constraint chk_clientes_idioma check (idioma is null or idioma in ('es','en')),
  constraint chk_clientes_telefono_estado check (
    telefono_estado is null or telefono_estado in ('CANONICO','PENDIENTE_REVISION','SIN_TELEFONO')
  ),
  constraint chk_clientes_telefono_normalizacion_origen check (
    telefono_normalizacion_origen is null or telefono_normalizacion_origen in (
      'APP_PAIS_DECLARADO','IMPORTACION_PAIS_DECLARADO','REVISION_MANUAL','LEGADO_SIN_VERIFICAR','SIN_NORMALIZAR'
    )
  ),
  constraint chk_clientes_telefono_canonico check (
    telefono_estado is distinct from 'CANONICO'
    or (
      whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$'
      and pais_telefono ~ '^[A-Z]{2}$'
      and telefono_normalizacion_origen is not null
    )
  )
);

create index if not exists idx_clientes_cliente on public.clientes(cliente);
create index if not exists idx_clientes_dni on public.clientes(dni);
create index if not exists idx_clientes_segmento on public.clientes(segmento_cliente);
create index if not exists idx_clientes_whatsapp on public.clientes(whatsapp);
create index if not exists idx_clientes_telefono_revision
  on public.clientes(updated_at, cliente_id)
  where telefono_estado = 'PENDIENTE_REVISION';
create unique index if not exists uq_clientes_whatsapp_e164
  on public.clientes(whatsapp_e164)
  where whatsapp_e164 is not null;

-- Semillas mínimas para QA de actualización/conflicto.
insert into public.clientes (
  cliente_id, cliente, whatsapp, dni, email, origen,
  whatsapp_e164, pais_telefono, telefono_estado,
  telefono_normalizacion_origen, telefono_normalizado_en
) values
  ('CLI-QA-EXISTENTE','Cliente QA Existente','999111222','70000001','qa.existente@example.test','QA_BOOTSTRAP',
   '+51999111222','PE','CANONICO','REVISION_MANUAL',now()),
  ('CLI-QA-CONFLICTO','Cliente QA Conflicto','999333444','70000002','qa.conflicto@example.test','QA_BOOTSTRAP',
   '+51999333444','PE','CANONICO','REVISION_MANUAL',now())
on conflict (cliente_id) do nothing;

select jsonb_build_object(
  'bootstrap','OK',
  'clientes',(select count(*) from public.clientes),
  'roles',(
    select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')
  )
) as qa_bootstrap;

# Catálogo canónico: Fase 3A (adaptador de lectura)

## Alcance y arquitectura

Caja usa Next.js App Router, componentes de servidor, acciones de servidor y
REST de Supabase mediante `lib/supabaseServer.ts`. La sesión interna se verifica
en `lib/auth.ts`; el único rol administrador existente es `ADMIN_GERALD`.

Esta fase incorpora una conexión **secundaria y exclusivamente server-side**.
`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` siguen siendo la conexión operativa
para movimientos, clientes, citas, pagos y catálogo legacy. No se reemplazan ni
se reutilizan como respaldo de la conexión canónica.

- `lib/catalogoCanonico.ts`: contrato explícito, validación y resumen sin configuración.
- `lib/catalogoCanonicoServer.ts`: frontera `server-only`, bandera y GET REST.
- `lib/catalogoDiagnosticoServer.ts`: autorización administrativa y respuesta mínima.
- `GET /api/admin/catalogo`: diagnóstico interno autenticado, dinámico, sin caché.

El adaptador se consume en el diagnóstico. **Nueva atención, Preparar cita,
acciones de guardado, promociones y RPC existentes conservan su catálogo legacy**.
No se conectan códigos canónicos a las RPC que todavía dependen de
`stg_services_catalog_v5`. La sustitución operativa y la interfaz pertenecen a
una fase posterior. Habilitar esta bandera habilita la lectura y validación
canónica; no constituye una migración de los flujos de venta.

## Configuración privada (no aplicada en esta entrega)

| Variable | Uso |
| --- | --- |
| `CATALOG_SUPABASE_URL` | URL secundaria: `https://wrbcdmcdxmhdwvftciro.supabase.co` |
| `CATALOG_SUPABASE_SERVICE_ROLE_KEY` | Credencial del catálogo; solo gestor privado del servidor |
| `CATALOG_CANONICAL_ENABLED` | Solo la cadena exacta `true` habilita la lectura |
| `CATALOG_EXPECTED_RELEASE_ID` | Debe ser `catalog-v1-web-4104385` |
| `CATALOG_EXPECTED_SERVICE_COUNT` | Debe ser `50` |

El proyecto es `vita-lima-threads-test`, ref `wrbcdmcdxmhdwvftciro`; el release
informado está `PUBLISHED`. El adaptador permite únicamente ese origen HTTPS.
Cambiar el destino o el contrato requiere revisión de código; cambiar las
variables de expectativas no puede relajar la validación de esta fase.

No colocar credenciales en `NEXT_PUBLIC_*`, `next.config.js`, props, componentes
cliente, respuestas, trazas o logs. `.env.example` mantiene la bandera apagada
y la URL/clave vacías. Configurar posteriormente estas variables en el entorno
privado del servidor; esta entrega no modifica secretos ni despliegues.

## Contrato y fallo seguro

`readCanonicalCatalog()` devuelve una unión discriminada:

- Deshabilitado: `{ source: "legacy", services: null }`, sin leer la clave ni
  hacer solicitudes. Los consumidores legacy existentes continúan intactos.
- Habilitado: `{ source: "canonical", services: CanonicalService[] }` únicamente
  después de validar toda la respuesta. Cualquier fallo lanza `CatalogError`.
  Los consumidores futuros deben detener la operación; nunca recuperar precios
  legacy en un `catch` ni interpretar un fallo como catálogo vacío.

Se consulta exclusivamente `public.catalog_services_read_v1`, con lista explícita
de las 23 columnas del contrato, `cache: no-store`, tiempo máximo de 10 segundos,
redirecciones prohibidas y `Prefer: count=exact`. No se consulta la vista pública
`catalog_public_snapshot_v1`. No se filtra por release ni por activo: hacerlo
podría ocultar filas inválidas. Se solicita hasta 51 filas y se exige
`Content-Range: 0-49/50`, además de exactamente 50 filas en el cuerpo; así se
rechaza una respuesta truncada o cuyo total real sea mayor.

Se exigen release exacto, todos activos, códigos únicos `SVC_` más tres dígitos,
precios y duraciones numéricos finitos positivos, distribución 23 INDIVIDUAL,
14 PACKAGE_TWO, 2 HOME, 4 PROGRAM, 3 BEAUTY y 4 FACIAL. PACKAGE_TWO admite
exactamente 2 personas; SVC_008 y SVC_009 deben existir y admitir 1–2.
Los 50 conservan `component_eligibility_status=PENDING_REVIEW`; no se autoriza
su uso como componentes mediante este adaptador.

Los campos textuales de reglas se preservan sin inventar enumeraciones que no
fueron suministradas. `name_en` y `commercial_group` admiten texto o null;
`component_eligible` admite booleano o null y se conserva sin reinterpretar;
`previous_price_pen` admite número positivo o null; `price_version` admite texto
no vacío o entero positivo. Todos los campos deben estar presentes. Las fechas
admiten ISO date o timestamp con zona; `valid_to` puede ser null y, si existe,
debe ser posterior a `valid_from`. El diagnóstico muestra todos los intervalos
de vigencia; no presupone una fecha única ni altera los precios según el reloj.
Estas reglas se verifican con fixtures sintéticas; no se ha inspeccionado una
respuesta real ni confirmado la conexión remota en esta entrega.

Las excepciones son códigos y mensajes estáticos. No se registra ni se devuelve
el cuerpo de errores HTTP, mensajes de red, URL o credenciales. La respuesta
validada proyecta solo columnas permitidas y el diagnóstico omite los servicios.

## Diagnóstico protegido

Con una sesión interna válida de `ADMIN_GERALD`, abrir `/api/admin/catalogo`
en el mismo navegador. La ruta verifica la firma de sesión mediante `getSession`
y comprueba el rol antes de consultar el adaptador; no depende de que el proxy
proteja `/api`. No admite claves de servicio como autenticación de navegador.

- Sin sesión: HTTP 401. SOCIO, VITA_OPERACION u otro rol: HTTP 403.
- Bandera apagada: HTTP 200, `source=legacy`, `connection=NOT_CHECKED`.
- Bandera habilitada y contrato válido: HTTP 200, `connection=OK`, release,
  total, distribución por categorías y todos los intervalos `valid_from/valid_to`.
- Configuración, conexión o contrato inválidos: HTTP 503, `ok=false`, código y
  mensaje seguro. No devuelve datos parciales ni precios de respaldo.

Todas las respuestas usan `Cache-Control: private, no-store` y `Vary: Cookie`.
La ruta no tiene enlace público ni altera la navegación o Nueva atención.

## Verificación sin secretos

Ejecutar `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` y
`git diff --check`. Las pruebas del adaptador inyectan variables sintéticas y
fetch simulado; verifican también permisos, errores 503 y ausencia de filtraciones.
No cargan archivos `.env*` ni hacen llamadas a Supabase.

Si existen archivos de entorno reales, realizar el build en una copia temporal
del código que los excluya, con entorno de proceso limpio y dependencias locales.
Revisar los archivos cliente y `.next/static` en esa copia buscando nombres
sensibles `CATALOG_SUPABASE_*`, cabeceras de autorización y la clave sintética.
No buscar secretos reales ni imprimir variables de entorno para esta revisión.

No se requieren SQL, migraciones, publicación/importación, cambios de Supabase,
Web o CRM, despliegues ni merge para validar esta fase.

## Resultados locales de la entrega

- Checkpoint limpio; `origin/main` verificado después de fetch en
  `9653c763d5defb92bd572e900453d996526a3abe`.
- `npm test`: 123 pruebas aprobadas, incluidas 40 nuevas del catálogo.
- `npm run typecheck`: aprobado.
- `npm run lint`: sin errores; 42 advertencias preexistentes en archivos ajenos
  a esta fase.
- `npm run build`: aprobado en copia temporal sin archivos de entorno reales y
  con entorno de proceso limitado a variables de sistema y una clave sintética.
- Revisión de 37 archivos de bundles y 3 componentes cliente: sin variables de
  conexión canónica, clave sintética o referencias cliente a la vista privada.
- Prueba HTTP local del build con sesiones firmadas sintéticas: anónimo y firma
  inválida 401, SOCIO y VITA_OPERACION 403, administrador con bandera apagada 200,
  administrador con bandera encendida y configuración incompleta 503. Todas
  las respuestas privadas sin caché; sin claves sintéticas en respuestas o logs.
- `git diff --check`: aprobado. Sin llamadas reales al catálogo ni modificaciones
  de SQL, Supabase, secretos, despliegues o flujos operativos.

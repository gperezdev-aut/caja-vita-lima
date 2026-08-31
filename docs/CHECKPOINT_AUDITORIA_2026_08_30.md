# Caja Vita Lima — Checkpoint Auditoría, Correcciones y Despliegue

Fecha: 2026-08-30  
Proyecto: Caja Vita Lima — Supabase / Contabo (producción)  
App producción: https://caja.vitalimaspa.com  
Repo: gperezdev-aut/caja-vita-lima  
Pull Request de referencia: #4 (`fix/auditoria-2026-08` → `main`)

---

## 1. Contexto

Se hizo una auditoría completa del código (arquitectura, seguridad, fórmulas financieras, diseño/UI) del repositorio, fuera de Claude Code, y se generó una lista priorizada de hallazgos.

Este documento registra qué se encontró, qué se corrigió, cómo se verificó, y cómo quedó desplegado en producción.

---

## 2. Hallazgos de la auditoría

| # | Hallazgo | Severidad | Archivo(s) |
|---|---|---|---|
| 1 | Las Server Actions `createCierreCajaAction` (`app/cierre-caja/actions.ts`), `createSalidaAction` (`app/registrar-salida/actions.ts`) y `updateComprobanteAction` (`app/comprobantes/actions.ts`) no verificaban sesión de usuario, a diferencia de `createAtencionAction` que sí lo hacía — permitía invocarlas sin login. | **CRÍTICO** | `app/cierre-caja/actions.ts`, `app/registrar-salida/actions.ts`, `app/comprobantes/actions.ts` |
| 2 | La fórmula de diferencia de caja en `createCierreCajaAction` sumaba `pozo_fondo` solo del lado de "efectivo contado" y no del lado de "caja esperada", lo que podía ocultar faltantes reales. | Alto | `app/cierre-caja/actions.ts` |
| 3 | `sql/006_reporte_financiero_mensual.sql` asignaba la sede `'Miraflores'` de forma fija a todos los pendientes de revisión de `migracion_revision`, sin importar su sede real (esa tabla no tiene columna de sede). | Medio | `sql/006_reporte_financiero_mensual.sql` |
| 4 | La misma vista mezclaba `prestamos_caja` (préstamos hacia la caja) dentro de `total_ingresos_confirmados` y `resultado_neto_confirmado`, sobreestimando la utilidad real. | Medio | `sql/006_reporte_financiero_mensual.sql` |
| 5 | `app/nueva-atencion/NuevaAtencionDynamicFields.tsx` era un componente completo sin usar en ningún lado (código muerto). | Bajo | `app/nueva-atencion/NuevaAtencionDynamicFields.tsx` |
| 6 | El login (`app/actions.ts`) no tenía límite de intentos fallidos de PIN, permitiendo fuerza bruta. | Alto | `app/actions.ts` |
| 7 | Mejoras menores de UX/accesibilidad: falta de estado "guardando..." en botones de envío (riesgo de doble clic/doble registro) y falta de `role="alert"` en mensajes de error/éxito para lectores de pantalla. | Bajo | Formularios de `cierre-caja`, `registrar-salida`, `comprobantes`, `nueva-atencion` |

---

## 3. Correcciones aplicadas — Pull Request #4

Rama `fix/auditoria-2026-08`, mergeada a `main` en el commit `4c9ebc1d339e4b4ffe33804272248f24280a6c7e` (merge de `78786c5`, `949f03d`, `9454fd5`, `8cdadd0`, `0f682bf`, `7b39adc`), con un commit por grupo de hallazgo:

- **`fix(security)`** — `requireModuleAccess()` agregado a las 3 Server Actions que faltaban.
- **`fix(cierre-caja)`** — fórmula corregida a:

  ```txt
  cajaEsperada = cajaInicial + pozoFondo + totalIngresos - totalSalidas
  diferencia   = efectivoContado - cajaEsperada
  ```

  Confirmado con el dueño del negocio que "pozo/fondo" es dinero que vive físicamente en la misma caja (aunque se pueda retirar en cualquier momento), por lo que debe contarse en ambos lados.
- **`fix(sql)`** — `sql/011_fix_reporte_financiero.sql` (migración nueva, no se tocaron 006/007):
  - Cambia la sede hardcodeada `'Miraflores'` por `'SIN_SEDE'`, documentando que la tabla origen no tiene columna de sede real.
  - Agrega la columna `resultado_neto_operativo = total_ingresos_confirmados - prestamos_caja - total_salidas` en `vista_reporte_financiero_mensual`, `vista_reporte_financiero_mensual_simple` y `vista_reporte_socio_mensual`, sin borrar `resultado_neto_confirmado`.
- **`chore`** — se eliminó `NuevaAtencionDynamicFields.tsx` tras confirmar que no se importaba en ningún archivo.
- **`feat(auth)`** — `sql/012_login_intentos.sql` crea la tabla `public.login_intentos`; `app/actions.ts` ahora bloquea el login por 15 minutos tras 5 intentos fallidos por usuario, y falla "abierto" (no bloquea el login) si la tabla aún no existe, para no dejar el sistema inaccesible por un despliegue incompleto.
- **`feat(ux)`** — `components/SubmitButton.tsx` (usa `useFormStatus` de `react-dom`) deshabilita los botones de guardar mientras el envío está en curso; `role="alert"` agregado a los mensajes de éxito/error en `cierre-caja`, `registrar-salida`, `comprobantes` y `nueva-atencion`.

Verificación antes de mergear: sin conflictos con `main`, `npm run typecheck` limpio, `npm run lint` solo con los warnings preexistentes de `no-explicit-any` (ninguno nuevo).

---

## 4. Despliegue en producción (Contabo)

Topología real descubierta en el servidor Contabo (`root@vmi3090707`), porque no estaba documentada en ningún lado del repo y costó tiempo reconstruirla:

- La app de caja interna corre en el dominio `caja.vitalimaspa.com`, servida por el contenedor Docker `caja-vita-lima` (imagen `caja-vita-lima:local`) en la red `n8n_default`, sin puerto expuesto al host — nginx (contenedor `n8n-nginx-1`) le hace `proxy_pass` a `http://caja-vita-lima:3000` por nombre de contenedor.
- `nueva.vitalimaspa.com` es un proyecto completamente distinto (la web pública/marketing de Vita Lima Spa, carpeta `/opt/vita-lima-web`) y **no debe confundirse con este repo**.
- El código de producción vivía en `/opt/caja-vita-lima`, un checkout git de este mismo repo (`origin: git@github.com:gperezdev-aut/caja-vita-lima.git`) que estaba parado en el commit `0c749172` (14 de julio de 2026), muy desactualizado.
- No existía `docker-compose.yml` en `/opt/caja-vita-lima`; el contenedor se maneja con `docker build` + `docker run` manual, con `--env-file` apuntando a `/opt/caja-vita-lima/.env.production` (variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CAJA_APP_PASSWORD`, `CAJA_SESSION_SECRET`), `--network n8n_default` y `--restart unless-stopped`.

Secuencia de despliegue ejecutada y confirmada exitosa el 30 de agosto de 2026:

```bash
git pull origin main                          # de 0c749172 a 4c9ebc1
docker build -t caja-vita-lima:local .
docker stop caja-vita-lima && docker rm caja-vita-lima
docker run -d --name caja-vita-lima \
  --network n8n_default \
  --restart unless-stopped \
  --env-file /opt/caja-vita-lima/.env.production \
  caja-vita-lima:local
```

Verificación post-despliegue:

- Contenedor arriba y sano (Next.js 16.2.11, `Ready in 753ms`).
- `curl` a `https://caja.vitalimaspa.com/login` devolvió `200 OK`.
- Se confirmó visualmente en el navegador el mensaje de bloqueo por intentos fallidos de login funcionando en producción real.

**Nota de seguridad:** durante el proceso de diagnóstico se expuso accidentalmente el valor de `SUPABASE_SERVICE_ROLE_KEY` en una sesión de chat. Se rotó la clave en Supabase (Project Settings → API) y se actualizó en `/opt/caja-vita-lima/.env.production`, con el contenedor reiniciado para tomar el valor nuevo.

---

## 5. Pendientes / decisiones abiertas para el futuro

1. Evaluar si conviene agregar una columna de sede real a `migracion_revision` en origen, en vez de dejar `'SIN_SEDE'` como pseudo-sede permanente.
2. Evaluar mover el flujo de creación de atención (4 inserts secuenciales sin transacción) a una función RPC de Postgres para atomicidad — quedó identificado en la auditoría original pero no se implementó en este PR.
3. Evaluar unificar los estilos inline repetidos en formularios (`cierre-caja`, `registrar-salida`) usando componentes compartidos, en vez de objetos de estilo duplicados por página.
4. Considerar crear un `docker-compose.yml` para `/opt/caja-vita-lima` en el servidor, para no depender de comandos `docker build`/`run` manuales en futuros despliegues.

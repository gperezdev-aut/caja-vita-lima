# Runbook — Cierre de Caja Física V3

## Objetivo

Desplegar de forma controlada la mejora que separa:

- gastos reales del negocio;
- retiros / depósitos de efectivo;
- entrega de propinas;
- transferencias internas;
- ajustes de caja;
- efectivo físico frente a pagos digitales.

La fórmula de cuadre es:

```
caja_esperada =
  caja_inicial
  + efectivo_vita_lima
  + propinas_en_efectivo
  - salidas_que_realmente_reducen_efectivo

diferencia =
  efectivo_contado - caja_esperada

efectivo_a_retirar =
  max(efectivo_contado - fondo_siguiente_dia, 0)
```

## Estado previo validado

Preflight de solo lectura contra producción:

- proyecto Supabase: `vita-lima-caja`;
- PostgreSQL remoto: 17.x;
- `caja_salidas.categoria_financiera` ya existe;
- la restricción de categorías financieras ya existe en producción;
- `metodo_salida` todavía no existe;
- `caja_movimientos_fondos` todavía no existe;
- las columnas físicas nuevas de `caja_cierres` todavía no existen;
- no hay cierres CERRADO duplicados por fecha + sede;
- al momento del preflight no había salidas ni cierres con fecha 2026-09-18 o 2026-09-19;
- `caja_salidas` y `caja_cierres` tienen RLS habilitado;
- el backend de Caja usa `SUPABASE_SERVICE_ROLE_KEY` exclusivamente desde servidor;
- la migración 042 concede explícitamente SELECT/INSERT/UPDATE/DELETE de
  `caja_movimientos_fondos` solo a `service_role`.

## Antes de tocar producción

1. Confirmar que el PR #46 tiene todos los checks verdes:
   - application tests;
   - TypeScript;
   - Next.js build;
   - contratos PostgreSQL;
   - contrato 042 en PostgreSQL 16;
   - contrato 042 en PostgreSQL 17;
   - Vercel preview.
2. Confirmar nuevamente que no existen cierres CERRADO duplicados:
   ```sql
   select fecha, sede, count(*) as cierres_cerrados
   from public.caja_cierres
   where upper(coalesce(estado,'')) = 'CERRADO'
   group by fecha, sede
   having count(*) > 1;
   ```
   Debe devolver 0 filas.
3. Confirmar si existen salidas del día de corte:
   ```sql
   select fecha, sede, count(*) as salidas
   from public.caja_salidas
   where fecha = current_date
   group by fecha, sede;
   ```
4. Si existen salidas del mismo día antes del deploy, NO asumir que fueron
   efectivo. Clasificarlas manualmente después de 042 antes de intentar cerrar.
5. Tener identificado el commit/imagen productiva anterior para rollback.

## Orden de despliegue

### 1. Aplicar SQL 042

Aplicar únicamente:

`sql/042_cierre_caja_fisica_v3.sql`

La migración es aditiva y no hace backfill de `metodo_salida`.

Verificar inmediatamente:

```sql
select to_regclass('public.caja_movimientos_fondos');

select column_name
from information_schema.columns
where table_schema='public'
  and table_name='caja_salidas'
  and column_name='metodo_salida';

select column_name
from information_schema.columns
where table_schema='public'
  and table_name='caja_cierres'
  and column_name in (
    'efectivo_vita_lima',
    'efectivo_propinas',
    'total_salidas_efectivo',
    'efectivo_a_retirar',
    'salidas_sin_metodo',
    'cierre_fisico_calculable'
  )
order by column_name;
```

Esperado:

- `caja_movimientos_fondos` existe;
- `metodo_salida` existe;
- aparecen las 6 columnas de cierre físico.

### 2. Verificar permisos

```sql
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema='public'
  and table_name='caja_movimientos_fondos'
order by grantee, privilege_type;
```

Para la app se requiere acceso de `service_role`. No se requiere acceso de
`anon` ni `authenticated`.

### 3. Merge del PR #46

Mergear únicamente después de que 042 esté aplicada y verificada.

Motivo: el código nuevo consulta columnas y tabla creadas por 042.

### 4. Deploy

Desplegar el nuevo `main` por el procedimiento normal de Caja Vita Lima.

Validar:

- contenedor healthy;
- Next.js Ready;
- HTTP 200 en `/login`;
- login operativo;
- `/registrar-salida` carga;
- `/cierre-caja` carga.

## QA funcional mínimo

Usar una sede controlada y montos de prueba reales autorizados.

### Caso A — gasto en efectivo

Registrar:

- naturaleza: GASTO;
- método: EFECTIVO;
- monto conocido.

Esperado:

- queda en `caja_salidas`;
- `categoria_financiera = GASTO_OPERATIVO`;
- reduce gasto del negocio;
- reduce caja física.

### Caso B — gasto por Yape

Registrar:

- naturaleza: GASTO;
- método: YAPE.

Esperado:

- cuenta como gasto;
- NO reduce caja física.

### Caso C — retiro para depósito

Registrar:

- naturaleza: RETIRO_CAJA;
- método: EFECTIVO.

Esperado:

- queda en `caja_movimientos_fondos`;
- NO cuenta como gasto;
- sí reduce caja física.

### Caso D — transferencia interna

Registrar:

- naturaleza: TRANSFERENCIA;
- método: BCP/YAPE/PLIN/otro digital permitido.

Esperado:

- no cuenta como gasto;
- no reduce caja física.

### Caso E — cierre cuadrado

Con caja esperada conocida:

- ingresar efectivo contado igual a caja esperada;
- dejar un fondo menor o igual al efectivo contado.

Esperado:

- diferencia = S/ 0.00;
- efectivo a retirar = efectivo contado - fondo;
- cierre guardado como CERRADO.

### Caso F — cierre duplicado

Intentar cerrar nuevamente la misma fecha + sede.

Esperado:

- UI lo bloquea;
- la base también lo bloquea por índice único.

## Históricos

No hacer backfill masivo de `metodo_salida`.

Los históricos no contienen evidencia suficiente para afirmar si una salida fue
efectivo o digital.

La clasificación financiera existente sí puede reconocer casos como
`DEPOSITOS` / `PROPINA`, pero el método de salida debe confirmarse antes de
usar esos registros para un cuadre físico histórico.

## Rollback recomendado

### Rollback de aplicación — preferido

Si la app nueva falla después de aplicar 042:

1. volver al commit/imagen productiva anterior;
2. ejecutar, solo si la app anterior necesita permitir nuevamente cierres
   duplicados, `sql/rollback/042_cierre_caja_fisica_v3_app_rollback.sql`;
3. NO borrar `caja_movimientos_fondos`;
4. NO borrar las columnas nuevas;
5. conservar cualquier dato escrito por V3 para análisis y recuperación.

La migración es aditiva: la app antigua ignora las columnas y tabla nuevas.

### Rollback destructivo — solo si no hubo escrituras V3

Solo considerar si se confirma que no existen registros creados por la versión V3.

Antes:

```sql
select count(*) from public.caja_movimientos_fondos;

select count(*)
from public.caja_cierres
where cierre_fisico_calculable = true;
```

Si cualquiera es mayor que 0, NO hacer rollback destructivo sin exportar y
reconciliar esos datos.

Objetos creados exclusivamente por 042 que podrían retirarse en un rollback
destructivo controlado:

- `public.caja_movimientos_fondos`;
- `public.caja_salidas.metodo_salida`;
- columnas físicas nuevas de `public.caja_cierres`;
- índices/constraints creados por 042.

NO eliminar `caja_salidas.categoria_financiera`: ya existía antes de 042.

## Criterio GO / NO-GO

GO si:

- CI completo verde;
- contrato PG17 verde;
- 042 aplicada sin error;
- permisos service_role correctos;
- rutas cargan;
- Caso A–F pasan.

NO-GO si:

- aparecen cierres duplicados antes de crear el índice;
- 042 falla parcialmente;
- Data API devuelve 42501 para `caja_movimientos_fondos`;
- el dashboard empieza a tratar RETIRO_CAJA como gasto;
- Yape/Plin/BCP alteran la caja física;
- un histórico sin método se asume automáticamente como EFECTIVO.

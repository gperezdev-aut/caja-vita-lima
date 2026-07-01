# Salidas sin fecha — Caja Vita Lima

## Objetivo

Controlar gastos/salidas que fueron migrados desde el Excel real pero no tienen fecha válida.

Estas salidas no deben asignarse a un mes sin revisión, porque podrían alterar el resultado mensual.

---

## Archivo SQL relacionado

```text
sql/008_salidas_sin_fecha_views.sql
```

---

## Corrección v8.1

La primera versión intentaba usar columnas:

```text
source_type
source_id
```

pero la tabla actual `public.caja_salidas` no tiene esas columnas.  
La versión v8.1 retira esas columnas de la vista `vista_salidas_sin_fecha`.

---

## Contexto

Durante la migración de `1SEMESTRE2026` se detectó:

```text
13 salidas sin fecha
S/ 385.20
```

Esto explica la diferencia entre:

```text
Total salidas en caja_salidas: S/ 5,586.20
Total salidas en reporte mensual: S/ 5,201.00
Diferencia: S/ 385.20
```

---

## Vistas creadas

### vista_salidas_sin_fecha

Lista detallada de salidas sin fecha.

```sql
select *
from public.vista_salidas_sin_fecha;
```

### vista_salidas_sin_fecha_resumen

Resumen de cantidad y monto.

```sql
select *
from public.vista_salidas_sin_fecha_resumen;
```

### vista_salidas_sin_fecha_por_tipo

Resumen por tipo de gasto.

```sql
select *
from public.vista_salidas_sin_fecha_por_tipo;
```

### vista_reporte_socio_resumen_con_alertas

Resumen para socio con alerta de salidas sin fecha.

```sql
select *
from public.vista_reporte_socio_resumen_con_alertas;
```

---

## Regla operativa

Las salidas sin fecha:

```text
- No se eliminan.
- No se asignan automáticamente a un mes.
- Se mantienen visibles como pendientes.
- Se revisan después para asignar fecha si corresponde.
```


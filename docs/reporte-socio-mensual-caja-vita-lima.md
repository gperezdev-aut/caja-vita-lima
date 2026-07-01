# Reporte para socio — Caja Vita Lima

## Objetivo

Crear una vista mensual más limpia y fácil de leer para socio / finanzas.

Esta vista no muestra columnas técnicas. Solo muestra información financiera útil.

---

## Archivo SQL relacionado

```text
sql/007_reporte_socio_mensual.sql
```

---

## Vistas creadas

### vista_reporte_socio_mensual

Reporte mensual con columnas amigables:

```text
mes
sede
Ingresos por servicios
Ingresos por Gift Cards
Préstamos de caja
Cuponidad cobrada en caja
Total ingresos confirmados
Total salidas
Resultado neto confirmado
Filas pendientes de revisión
Ingreso pendiente por revisar
Salida pendiente por revisar
```

---

### vista_reporte_socio_mensual_resumen

Resumen acumulado de todo lo cargado.

Sirve para ver el total general de la migración actual.

---

### vista_reporte_socio_mes_actual

Muestra el último mes cargado.

Importante:

```text
Si el mes todavía no terminó, tomarlo como preliminar.
```

---

## Consultas útiles

Reporte mensual:

```sql
select *
from public.vista_reporte_socio_mensual;
```

Resumen acumulado:

```sql
select *
from public.vista_reporte_socio_mensual_resumen;
```

Último mes cargado:

```sql
select *
from public.vista_reporte_socio_mes_actual;
```

---

## Interpretación

### Ingresos por servicios

Ventas normales de masajes / servicios de Vita Lima.

### Ingresos por Gift Cards

Ventas de Gift Cards. No significa que la Gift Card ya fue usada.

### Préstamos de caja

Dinero que ingresó como préstamo o apoyo de caja. No debe interpretarse como venta comercial.

### Cuponidad cobrada en caja

Montos relacionados a Cuponidad que sí se cobraron en tienda.

### Total ingresos confirmados

Suma de ingresos confirmados ya migrados a `caja_movimientos`.

### Total salidas

Gastos / egresos registrados en `caja_salidas`.

### Resultado neto confirmado

```text
Total ingresos confirmados - Total salidas
```

### Pendientes de revisión

Filas que no fueron incluidas como confirmadas y quedaron en `migracion_revision`.

---

## Estado

```text
SQL preparado.
Pendiente: subir a GitHub.
Pendiente: ejecutar en Supabase.
```

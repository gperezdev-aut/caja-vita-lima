# Comprobantes editables — Caja Vita Lima

## Objetivo

Preparar la base para que la futura app pueda editar boletas, facturas y comprobantes de manera ordenada.

Antes solo existían los campos históricos:

```text
estado_boleta
numero_boleta
```

Ahora se agregan campos nuevos para control real:

```text
tipo_comprobante
estado_comprobante_manual
numero_comprobante_final
fecha_emision_comprobante
observacion_comprobante
comprobante_revisado_por
comprobante_revisado_at
```

---

## Archivo SQL relacionado

```text
sql/010_comprobantes_schema_patch.sql
```

---

## Qué hace este SQL

1. Agrega columnas nuevas a `caja_movimientos`.
2. Inicializa valores seguros usando los campos antiguos.
3. Crea vistas de control para edición futura.

---

## Vistas creadas

```text
vista_comprobantes_control_editable
vista_comprobantes_control_resumen
vista_comprobantes_para_revisar
vista_reporte_socio_resumen_con_alertas_v3
```

---

## Valores sugeridos

### tipo_comprobante

```text
BOLETA
FACTURA
SIN_COMPROBANTE
NO_APLICA
POR_DEFINIR
```

### estado_comprobante_manual

```text
OK
PENDIENTE
OBSERVAR
NO_APLICA
```

### estado_comprobante_final_calculado

```text
OK_COMPLETO
OK_SIN_NUMERO
PENDIENTE
OBSERVAR
SIN_NUMERO
REVISAR
NO_APLICA
```

---

## Consultas útiles

Resumen:

```sql
select *
from public.vista_comprobantes_control_resumen;
```

Pendientes para revisar:

```sql
select *
from public.vista_comprobantes_para_revisar;
```

Reporte socio con alertas v3:

```sql
select *
from public.vista_reporte_socio_resumen_con_alertas_v3;
```

---

## Regla operativa

Los campos antiguos se conservan como origen histórico.

Los campos nuevos serán los que use la app para edición futura.

```text
estado_boleta / numero_boleta = dato histórico
tipo_comprobante / estado_comprobante_manual / numero_comprobante_final = dato controlado actual
```

---

## Mejora futura

Cuando tengamos la app, la edición debería funcionar así:

```text
1. Caja o admin abre movimiento.
2. Selecciona tipo de comprobante.
3. Marca estado: OK / Pendiente / Observar / No aplica.
4. Ingresa número final.
5. Guarda observación.
6. El sistema registra quién revisó y cuándo.
```

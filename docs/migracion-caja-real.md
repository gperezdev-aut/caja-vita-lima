# Migración de Caja Real — Vita Lima

## Objetivo

Documentar cómo se transformará la información real operativa de la caja actual de Vita Lima hacia el modelo ordenado de la nueva Caja Vita Lima.

Esta migración no busca copiar el Excel real tal como está, sino convertirlo a una estructura más limpia, compatible con Supabase y con la futura app web.

---

## Fuentes de información

### Fuente A — Caja limpia / modelo ordenado

Archivo de referencia:

```text
Caja_Vita_Lima_FINAL_LIMPIA_CLIENTES.xlsx
```

Uso principal:

- Sirve como modelo ordenado.
- Define la estructura limpia de clientes, citas, movimientos, pagos, detalle de atención, gift cards, cupones, salidas y cierres.
- Es la referencia para crear las tablas de Supabase.

Tablas esperadas según este modelo:

```text
CLIENTES
CITAS_RESERVADAS
CAJA_MOVIMIENTOS
CAJA_PAGOS
CAJA_ATENCION_DETALLE
GIFT_CARDS
CUPONES_CONVENIOS
CAJA_SALIDAS
CAJA_CIERRES
CONFIG_LISTAS
USUARIOS
```

---

### Fuente B — Caja real operativa actual

Archivo de referencia:

```text
_CAJA VIRTUAL VITA LIMA Miraflores (4).xlsx
```

Uso principal:

- Contiene la información real que actualmente se usa en caja.
- Tiene registros históricos y operativos.
- Puede tener información mezclada en una misma hoja: ingresos, pagos, terapistas, salidas, boletas, cierres, paquetes y gift cards.

Hojas detectadas / esperadas:

```text
1SEMESTRE
2SEMESTRE
1SEMESTRE2026
PAQUETES
GIFT CARDS
CAMPOS
COMMENT
CAJA
```

---

## Estrategia general

La migración se hará así:

```text
Excel real operativo
        ↓
Limpieza y transformación
        ↓
Formato ordenado tipo Caja limpia
        ↓
Importación a Supabase
        ↓
Validación de montos y registros
```

No se importará la Fuente B directamente a Supabase sin transformar.

---

## Regla principal

La Fuente B se transforma tomando como modelo la Fuente A.

En otras palabras:

```text
La Caja real aporta la información.
La Caja limpia define la estructura.
Supabase será el destino final.
```

---

## Mapeo general de hojas

### 1SEMESTRE / 2SEMESTRE / 1SEMESTRE2026

Estas hojas se transformarán principalmente en:

```text
CLIENTES
CAJA_MOVIMIENTOS
CAJA_PAGOS
CAJA_ATENCION_DETALLE
CAJA_SALIDAS
```

Posibles columnas origen:

```text
FECHA
N° PAX
Nombre Pax
TERAPISTA
HORA INICIO
TIEMPO en MIN
TIPO TERAPIA
EFECTIVO
DEPOSITO
YAPE/PLIN / BANCO
TARJETA IZIPAY / LINK
ESTADO DE BOLETA
NÚMERO BOLETA
SALIDA
TIPO GASTO
MONTO
CIERRE
MES
Responsables de caja
```

---

### GIFT CARDS

Esta hoja se transformará principalmente en:

```text
GIFT_CARDS
CAJA_MOVIMIENTOS
CAJA_PAGOS
```

Regla:

- Si una Gift Card fue vendida y pagada, debe generar un registro en `gift_cards`.
- Si esa venta ingresó dinero a caja, también debe reflejarse como movimiento y pago.
- El uso posterior de una Gift Card no debe duplicar la venta.

---

### PAQUETES

Esta hoja se revisará como posible fuente para:

```text
CLIENTES
CAJA_MOVIMIENTOS
CAJA_PAGOS
CAJA_ATENCION_DETALLE
```

Regla:

- Si representa una venta de paquete, se puede registrar como movimiento comercial.
- Si representa sesiones ya usadas, se debe evaluar si corresponde a atención, historial o control separado.
- No migrar paquetes sin revisar significado operativo.

---

### CAJA

Esta hoja se revisará como posible fuente para:

```text
CAJA_CIERRES
```

Regla:

- No importar directamente hasta confirmar si contiene cierres reales, resumen manual o plantilla.
- Si hay cierres diarios/mensuales, se transforman a `caja_cierres`.

---

### COMMENT

Esta hoja se revisará posteriormente.

Posibles destinos futuros:

```text
comentarios_clientes
feedback
notas_operativas
reseñas
```

Regla:

- No migrar en primera etapa.
- Documentar contenido antes de decidir destino.

---

## Modelo destino en Supabase

Las tablas destino iniciales son:

```text
config_listas
usuarios
clientes
citas_reservadas
caja_movimientos
caja_pagos
caja_atencion_detalle
gift_cards
cupones_convenios
caja_salidas
caja_cierres
```

---

## Orden recomendado de migración

La migración se hará por etapas.

### Etapa 1 — Base operativa limpia

```text
1. config_listas
2. usuarios
```

Estado actual:

- Ya fueron creadas en Supabase.
- Ya se cargó seed inicial con sedes, métodos de pago, terapistas, responsables, tipos de gasto, roles y usuarios temporales.

---

### Etapa 2 — Clientes

Fuente:

```text
Caja limpia
Caja real operativa
```

Destino:

```text
clientes
```

Criterios de deduplicación:

```text
1. WhatsApp
2. DNI
3. Nombre normalizado como apoyo, no como llave principal
```

Reglas:

- WhatsApp debe limpiarse a formato numérico.
- Si tiene 9 dígitos peruanos, se puede anteponer 51.
- No mezclar homónimos solo por nombre.
- Mantener historial comercial cuando exista.

---

### Etapa 3 — Citas reservadas

Fuente:

```text
Caja limpia
Apps Script actual
```

Destino:

```text
citas_reservadas
```

Reglas:

- Mantener `reserva_id` si existe.
- Normalizar fecha y hora.
- Mantener estado de cita.
- No duplicar citas ya atendidas si también existen como movimiento.

---

### Etapa 4 — Movimientos de caja

Fuente:

```text
1SEMESTRE
2SEMESTRE
1SEMESTRE2026
Caja limpia
```

Destino:

```text
caja_movimientos
```

Reglas:

- Cada atención o venta debe tener un `movimiento_id`.
- Una fila operativa puede convertirse en un movimiento.
- Si hay salida/gasto en la misma hoja, se separa hacia `caja_salidas`.
- No mezclar ingresos y salidas en una misma fila destino.

---

### Etapa 5 — Pagos

Fuente:

```text
Columnas de efectivo, depósito, Yape/Plin/Banco, tarjeta Izipay/link
```

Destino:

```text
caja_pagos
```

Reglas:

- Un movimiento puede tener varios pagos.
- Si una atención tiene efectivo + yape, se crean dos filas en `caja_pagos`.
- Cada pago debe apuntar al `movimiento_id`.
- Montos en cero o vacíos no se migran como pago.

Ejemplo:

```text
Movimiento MOV-001
- Pago efectivo: S/ 50
- Pago Yape: S/ 30
```

Se convierte en:

```text
caja_pagos
PAY-001 | MOV-001 | EFECTIVO | 50
PAY-002 | MOV-001 | YAPE     | 30
```

---

### Etapa 6 — Detalle de atención / terapistas

Fuente:

```text
TERAPISTA
N° PAX
TIEMPO en MIN
TIPO TERAPIA
```

Destino:

```text
caja_atencion_detalle
```

Reglas:

- Si hay una terapista por atención, crear un detalle.
- Si hay varios pax/terapistas, crear un detalle por persona.
- Si no hay terapista, dejar pendiente o registrar como vacío según validación.
- Duración debe conservarse si existe.

---

### Etapa 7 — Gift Cards

Fuente:

```text
GIFT CARDS
```

Destino:

```text
gift_cards
caja_movimientos
caja_pagos
```

Reglas:

- Venta de Gift Card genera ingreso.
- Uso de Gift Card no debe duplicar ingreso.
- Mantener comprador, destinatario, monto, método de pago, estado y fecha.

---

### Etapa 8 — Salidas

Fuente:

```text
SALIDA
TIPO GASTO
MONTO
Responsables de caja
```

Destino:

```text
caja_salidas
```

Reglas:

- Solo migrar filas que representen egresos reales.
- No confundir descuentos o ajustes con salidas.
- Registrar responsable si existe.

---

### Etapa 9 — Cierres

Fuente:

```text
CAJA
CIERRE
MES
```

Destino:

```text
caja_cierres
```

Reglas:

- Migrar solo si representa cierre real.
- Validar contra ingresos y salidas.
- Si el cierre es resumen manual, marcar observación.

---

## Primera prueba recomendada

La primera prueba debe hacerse solo con:

```text
1SEMESTRE2026
```

Motivo:

- Es la información más reciente.
- Permite validar si la estructura nueva representa bien la operación actual.
- Reduce el riesgo antes de migrar años o semestres anteriores.

---

## Validaciones antes de importar

Antes de importar a Supabase se deben revisar:

```text
Fechas válidas
Horas válidas
Montos numéricos
WhatsApp limpios
IDs únicos
Filas vacías
Celdas con errores
Pagos duplicados
Boletas duplicadas
Movimientos sin cliente
Movimientos sin monto
Salidas mezcladas con ingresos
```

---

## Validaciones después de importar

Después de importar se deben revisar:

```sql
select count(*) from clientes;
select count(*) from caja_movimientos;
select count(*) from caja_pagos;
select count(*) from caja_atencion_detalle;
select count(*) from caja_salidas;
select count(*) from gift_cards;
```

Validaciones financieras:

```sql
select sum(total_pagado) from caja_movimientos;
select sum(monto) from caja_pagos;
select metodo, sum(monto) from caja_pagos group by metodo;
select sum(monto) from caja_salidas;
```

Regla:

```text
La suma de pagos debe cuadrar razonablemente con los movimientos.
Las salidas deben quedar separadas de ingresos.
```

---

## Riesgos conocidos

```text
1. Fechas en formato mezclado.
2. Horas convertidas por Excel.
3. Montos escritos como texto.
4. Celdas combinadas.
5. Filas que mezclan ingreso y salida.
6. Nombres de clientes sin WhatsApp.
7. Terapistas múltiples en una sola celda.
8. Gift Cards vendidas y usadas en periodos distintos.
9. Boletas pendientes o sin número.
10. Registros históricos incompletos.
```

---

## Decisión técnica

La migración real no se hará manual fila por fila.

Se recomienda generar un proceso de transformación usando:

```text
Python / pandas
```

o una plantilla intermedia CSV.

Resultado esperado:

```text
clientes_import.csv
caja_movimientos_import.csv
caja_pagos_import.csv
caja_atencion_detalle_import.csv
caja_salidas_import.csv
gift_cards_import.csv
```

Estos CSV se importarán después a Supabase de manera controlada.

---

## Estado

```text
Estado actual: documentado.
Supabase: tablas creadas.
Seed inicial: cargado.
Migración real: pendiente.
Primera hoja candidata: 1SEMESTRE2026.
```

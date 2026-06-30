# Diagnóstico inicial — Hoja 1SEMESTRE2026

Archivo fuente:

```text
_CAJA VIRTUAL VITA LIMA Miraflores (4).xlsx
```

Hoja revisada:

```text
1SEMESTRE2026
```

---

## Resultado general

La hoja `1SEMESTRE2026` sí sirve como primera candidata para la migración de prueba.

No debe importarse directo a Supabase. Primero debe transformarse al modelo ordenado de la nueva Caja.

---

## Dimensiones detectadas

```text
Filas totales aproximadas: 1023
Columnas totales aproximadas: 198
Columnas operativas principales: A:S
```

Columnas principales detectadas:

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
SALIDA (Propinas, compras, adelantos, etc)
TIPO GASTO
MONTO
CIERRE
MES
Responsables de caja
```

---

## Conteos relevantes

```text
Filas con algún dato: 964
Filas con fecha: 615
Filas con cliente/nombre pax: 570
Filas con terapista: 567
Filas con servicio/tipo terapia: 601
Filas con ingreso detectado: 502
Filas con salida/gasto detectado: 136
```

---

## Montos detectados

```text
Efectivo total detectado: S/ 5,690.00
Depósito / banco / billetera detectado: S/ 14,921.90
Tarjeta Izipay / Link detectado: S/ 25,939.70

Ingreso total detectado por columnas de pago: S/ 46,551.60

Salidas / gastos detectados: S/ 5,586.20
```

Estos montos son una primera lectura automática. Deben validarse contra la caja original antes de importar.

---

## Métodos de pago detectados en columna YAPE/PLIN / BANCO

```text
YAPE: 157 registros
PLIN: 34 registros
BCP: 5 registros
INTERB: 4 registros
BBVA: 2 registros
```

Observación:

La columna `DEPOSITO` parece contener el monto y la columna `YAPE/PLIN / BANCO` parece contener el método o banco en algunos casos.

Regla tentativa:

```text
DEPOSITO = monto del pago por billetera/banco.
YAPE/PLIN / BANCO = detalle del método.
```

---

## Estados de boleta detectados

```text
OK: 302 registros
PENDIENTE: 30 registros
```

Regla tentativa:

```text
OK → estado_boleta = Emitida
PENDIENTE → estado_boleta = Pendiente
```

Debe validarse si `OK` siempre equivale a boleta emitida.

---

## Tipos de gasto detectados

```text
PASAJE: 33
PROPINA: 28
INSUMOS: 25
OTROS: 17
LAVANDERIA: 12
DEPOSITOS: 10
PAGO PERSONAL: 9
AGUA: 8
```

Regla:

Estos registros deben separarse hacia `caja_salidas`, no mezclarse con ingresos.

---

## Terapistas detectadas con mayor frecuencia

```text
LUSY: 88
CECILIA: 59
ROSSANA: 48
MIRIAM: 46
MILAGRITOS: 43
DANITZA: 28
ALISON: 26
APOYO: 22
LUSY + MILAGRITOS: 17
ALLISON: 17
MELISSA: 14
LUIS: 12
MARIA E: 11
```

Observación:

Hay registros con terapistas múltiples en una sola celda:

```text
LUSY + MILAGRITOS
ROSS-CECI
ALISON-LUSY
DANITZA-APOYO
MILAGRITOS + APOYO
```

Regla tentativa:

- Si hay una terapista, crear un registro en `caja_atencion_detalle`.
- Si hay dos o más terapistas, dividir en varios registros de detalle cuando sea posible.
- Si no se puede dividir con certeza, conservar el texto original en observación.

---

## Problemas detectados

```text
1. Algunas filas tienen fecha pero no tienen ingreso.
2. Algunas filas tienen salida/gasto mezclado con datos de atención.
3. Algunas filas parecen ser apoyo interno, Therapy o Cuponidad sin pago directo.
4. La columna MES contiene algunos valores raros como #VALUE! o #REF!.
5. Hay terapistas múltiples en una sola celda.
6. La columna YAPE/PLIN / BANCO mezcla métodos de pago en texto.
7. La columna DEPOSITO parece ser monto, no método.
8. Algunas filas tienen propinas como servicio o salida.
9. No todos los registros tienen cliente claro.
10. No todos los registros tienen boleta.
```

---

## Destino propuesto en Supabase

La hoja `1SEMESTRE2026` se transformará principalmente en:

```text
clientes
caja_movimientos
caja_pagos
caja_atencion_detalle
caja_salidas
```

---

## Reglas de transformación propuestas

### Clientes

Destino:

```text
clientes
```

Campos tentativos:

```text
cliente = Nombre Pax
ultima_visita = FECHA
ultimo_servicio = TIPO TERAPIA
ultima_sede = Miraflores
origen = MIGRACION_CAJA_REAL_1SEMESTRE2026
```

Observación:

Esta hoja no parece tener WhatsApp ni DNI, por lo que la deduplicación por nombre debe hacerse con cuidado.

---

### Movimientos

Destino:

```text
caja_movimientos
```

Cada fila con ingreso debe convertirse en un movimiento de caja.

Campos tentativos:

```text
fecha = FECHA
hora = HORA INICIO
sede = Miraflores
tipo_movimiento = ATENCION_HISTORICA
cliente = Nombre Pax
n_pax = N° PAX
servicio = TIPO TERAPIA
duracion = TIEMPO en MIN
monto_servicio = suma de pagos
total_cobrar = suma de pagos
total_pagado = suma de pagos
estado_boleta = según ESTADO DE BOLETA
numero_boleta = NÚMERO BOLETA
responsable = Responsables de caja
source_type = MIGRACION_CAJA_REAL
source_id = hoja + fila origen
```

---

### Pagos

Destino:

```text
caja_pagos
```

Reglas tentativas:

```text
EFECTIVO > 0 → crear pago EFECTIVO
DEPOSITO > 0 → crear pago con método según YAPE/PLIN / BANCO
TARJETA IZIPAY / LINK > 0 → crear pago IZIPAY POS o LINK IZIPAY
```

Si no se puede determinar si fue POS o link, usar:

```text
IZIPAY POS
```

y conservar detalle en `metodo_detalle`.

---

### Detalle de atención

Destino:

```text
caja_atencion_detalle
```

Reglas:

```text
terapista = TERAPISTA
servicio = TIPO TERAPIA
duracion = TIEMPO en MIN
monto_asignado = total_pagado / cantidad de terapistas detectadas
```

---

### Salidas

Destino:

```text
caja_salidas
```

Cada fila con `MONTO > 0` en la zona de salidas debe generar una salida.

Campos tentativos:

```text
fecha = FECHA
hora = HORA INICIO si aplica
sede = Miraflores
tipo_gasto = TIPO GASTO
concepto = SALIDA / observación
monto = MONTO
responsable = Responsables de caja o SALIDA si ahí figura el responsable
observacion = referencia a hoja y fila origen
```

---

## Decisión recomendada

Antes de importar a Supabase, crear archivos intermedios:

```text
clientes_import_1SEMESTRE2026.csv
caja_movimientos_import_1SEMESTRE2026.csv
caja_pagos_import_1SEMESTRE2026.csv
caja_atencion_detalle_import_1SEMESTRE2026.csv
caja_salidas_import_1SEMESTRE2026.csv
```

Luego validar:

```text
1. Conteos
2. Suma de ingresos
3. Suma de pagos
4. Suma de salidas
5. Boletas pendientes
6. Filas rechazadas o dudosas
```

---

## Siguiente paso

Preparar el primer transformador de prueba para `1SEMESTRE2026`.

Resultado esperado:

```text
CSV limpios para importación controlada a Supabase.
Archivo de observaciones con filas dudosas.
```

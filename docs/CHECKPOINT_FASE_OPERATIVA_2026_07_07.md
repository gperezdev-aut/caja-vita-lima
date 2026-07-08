# Caja Vita Lima — Checkpoint Fase Operativa

Fecha: 2026-07-07  
Proyecto: Caja Vita Lima — Supabase / Vercel  
App: https://caja-vita-lima.vercel.app  
Repo: gperezdev-aut/caja-vita-lima  
Supabase project: vita-lima-caja

---

## 1. Objetivo de este checkpoint

Este documento deja congelado el estado actual de la app **Caja Vita Lima** después de validar los módulos principales de operación diaria.

La idea es no perder contexto antes de continuar con mejoras más fuertes como permisos finos, perfil de cliente, reportes avanzados o integración futura con WhatsApp / n8n.

---

## 2. Stack actual

- **GitHub:** código, SQL y documentación.
- **Supabase:** PostgreSQL, tablas y vistas.
- **Vercel:** despliegue de app Next.js.
- **Next.js:** app web interna.
- **n8n:** automatizaciones futuras.

---

## 3. Reglas de seguridad

Nunca subir ni pegar en chat:

- `SUPABASE_SERVICE_ROLE_KEY`
- `CAJA_SESSION_SECRET`
- claves privadas
- tokens
- passwords reales sensibles

Variables esperadas en Vercel:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CAJA_APP_PASSWORD` — legado/simple, puede quedar mientras se termina migración.
- `CAJA_SESSION_SECRET`

---

## 4. Tablas principales del sistema

Tablas existentes y usadas en esta fase:

- `clientes`
- `citas_reservadas`
- `caja_movimientos`
- `caja_pagos`
- `caja_atencion_detalle`
- `caja_salidas`
- `caja_cierres`
- `gift_cards`
- `cupones_convenios`
- `migracion_revision`
- `migracion_correcciones`
- `config_listas`
- `usuarios`

---

## 5. Vistas principales usadas por dashboard/reportes

- `vista_reporte_socio_resumen_con_alertas_v3`
- `vista_reporte_socio_mensual`
- `vista_reporte_socio_mes_actual`
- `vista_comprobantes_control_resumen`
- `vista_salidas_sin_fecha_resumen`

---

## 6. Dashboard general validado

Ruta:

```txt
/
```

Estado validado:

- Dashboard protegido por login.
- Sidebar visible.
- Tarjetas principales correctas.
- Filtros por periodo y sede funcionando.
- Botón **Ver todo** vuelve a vista general.

Totales generales validados:

| Indicador | Valor |
|---|---:|
| Ingresos confirmados | S/ 42,059.10 |
| Total salidas | S/ 5,201.00 |
| Resultado neto | S/ 36,858.10 |
| Pendientes migración | 90 |
| Servicios | S/ 39,221.90 |
| Gift Cards | S/ 2,427.90 |
| Préstamos de caja | S/ 299.50 |
| Cuponidad en caja | S/ 109.80 |

Resumen general validado:

- Vista: Todo lo cargado.
- Último mes con movimiento: junio 2026.
- Ingresos último mes: S/ 4,487.80.
- Neto último mes: S/ 4,066.80.

---

## 7. Dashboard con filtros validado

Filtros disponibles:

- Desde
- Hasta
- Sede

Ejemplo validado: mayo + junio 2026, todas las sedes.

| Indicador | Valor |
|---|---:|
| Ingresos confirmados | S/ 16,432.90 |
| Total salidas | S/ 1,297.40 |
| Resultado neto | S/ 15,135.50 |
| Pendientes migración | 29 |
| Servicios | S/ 14,987.70 |
| Gift Cards | S/ 1,095.40 |
| Préstamos de caja | S/ 240.00 |
| Cuponidad en caja | S/ 109.80 |

Ejemplo validado: junio 2026, Miraflores.

| Indicador | Valor |
|---|---:|
| Ingresos confirmados | S/ 4,487.80 |
| Total salidas | S/ 421.00 |
| Resultado neto | S/ 4,066.80 |
| Pendientes migración | 8 |
| Servicios | S/ 3,887.00 |
| Gift Cards | S/ 397.00 |
| Préstamos de caja | S/ 94.00 |
| Cuponidad en caja | S/ 109.80 |

Estado:

```txt
Dashboard general ✅
Dashboard filtrado por periodo ✅
Botón Ver todo ✅
```

---

## 8. Login por usuario y roles

Tabla usada:

```txt
usuarios
```

Columnas vistas:

- `id`
- `usuario`
- `pin`
- `rol`
- `nombre`
- `activo`
- `nota`
- `created_at`
- `updated_at`

Usuarios activos definidos:

| Usuario | Rol | Uso esperado |
|---|---|---|
| `gerald` | `ADMIN_GERALD` | Administrador total |
| `luis` | `SOCIO` | Socio, operación y reportes |
| `nati` | `SOCIO` | Socia, operación y reportes |
| `vita` | `VITA_OPERACION` | Caja / terapistas / operación diaria |

Notas:

- Se eliminaron usuarios antiguos/duplicados innecesarios.
- El login muestra nombre y rol en sidebar.
- El menú cambia según rol.
- Los PIN actuales son normales para prueba; luego deben cambiarse si se requiere mayor seguridad.

Estado:

```txt
Login por usuario ✅
Roles básicos ✅
Menú según rol ✅
```

---

## 9. Nueva atención

Ruta:

```txt
/nueva-atencion
```

Guarda en:

- `clientes`
- `citas_reservadas`
- `caja_movimientos`
- `caja_pagos`
- `caja_atencion_detalle`

Campos principales:

- tipo de registro
- fecha
- hora
- sede
- cliente
- WhatsApp
- DNI
- número de personas
- servicio
- duración
- terapista 1
- terapista 2
- monto total
- monto pagado / adelanto
- método de pago
- estado boleta
- número boleta/factura
- responsable
- observación

Prueba validada:

- Cliente: `PRUEBA SISTEMA`
- WhatsApp: `999999999`
- Servicio: Masaje relajante
- Monto total: 0
- Monto pagado: 0
- Observación: Prueba de módulo nueva atención desde Vercel

Se validó inserción en:

- `caja_movimientos`
- `citas_reservadas`
- `caja_atencion_detalle`
- `clientes`

Se limpió la prueba después.

Estado:

```txt
Nueva atención ✅
Inserción múltiple validada ✅
Limpieza de prueba validada ✅
```

---

## 10. Citas de hoy

Ruta:

```txt
/citas-hoy
```

Funciones validadas:

- Lista atenciones/reservas del día.
- Muestra totales: total a cobrar, total pagado, pendiente, cantidad.
- Filtros por fecha y sede.
- Botones rápidos: Nueva atención / Registrar salida.
- Respeta roles visibles.

Validaciones realizadas:

- Vista sin registros para fecha actual.
- Vista filtrada para 2026-07-06 + Miraflores.
- Se visualizaron registros de prueba antes de limpieza.
- Después de limpiar pruebas, quedó en cero cuando correspondía.

Estado:

```txt
Citas de hoy ✅
Filtros por fecha/sede ✅
```

---

## 11. Registrar salida

Ruta:

```txt
/registrar-salida
```

Tabla usada:

```txt
caja_salidas
```

Columnas vistas:

- `salida_id`
- `fecha`
- `hora`
- `sede`
- `tipo_gasto`
- `concepto`
- `monto`
- `responsable`
- `source_movimiento_id`
- `observacion`
- `created_at`

Funciones validadas:

- Registro de salida.
- Filtros por fecha y sede.
- Total de salidas por fecha/sede.
- Formulario mantiene fecha y sede filtrada.

Prueba validada:

- Salida de prueba con monto 0.
- Se confirmó inserción en `caja_salidas`.
- Se limpió la prueba después.

Estado:

```txt
Registrar salida ✅
Filtros por fecha/sede ✅
Limpieza de prueba validada ✅
```

---

## 12. Comprobantes editables

Ruta:

```txt
/comprobantes
```

Tabla principal:

```txt
caja_movimientos
```

Columnas usadas/actualizadas:

- `tipo_comprobante`
- `estado_comprobante_manual`
- `numero_comprobante_final`
- `fecha_emision_comprobante`
- `observacion_comprobante`
- `comprobante_revisado_por`
- `comprobante_revisado_at`
- `updated_at`

Funciones validadas:

- Lista editable de comprobantes pendientes/por revisar.
- Guardado de tipo, estado, número, fecha, observación y revisado por.
- Mensaje de éxito luego de guardar.
- Confirmación directa en Supabase por `movimiento_id`.

Prueba validada:

- Cliente: `PRUEBA COMPROBANTE`
- Movimiento: generado desde app.
- Se actualizó comprobante como prueba.
- Luego se limpió la data de prueba.

Estado:

```txt
Comprobantes editables ✅
Actualización en caja_movimientos validada ✅
```

---

## 13. Cierre de caja

Ruta:

```txt
/cierre-caja
```

Tabla usada:

```txt
caja_cierres
```

Columnas vistas:

- `cierre_id`
- `fecha`
- `sede`
- `caja_inicial`
- `efectivo_contado`
- `pozo_fondo`
- `total_ingresos`
- `total_salidas`
- `caja_esperada`
- `diferencia`
- `pax_total`
- `boletas_pendientes`
- `responsable`
- `estado`
- `observacion`
- `created_at`

Funciones validadas:

- Registro de cierre diario por sede.
- Filtros por fecha y sede.
- Muestra ingresos, salidas, pax, boletas pendientes y cantidad de cierres.
- No se permite mezclar sedes en el cierre.

Prueba realizada:

- Cierre de prueba para 2026-07-06 + Miraflores.
- Se detectó que tenía `pax_total = 2`, por eso no entró en un borrado inicial con `pax_total = 0`.
- Se borró finalmente por condiciones seguras sin `pax_total = 0`.
- La app quedó mostrando `Cierres: 0` para 2026-07-06 + Miraflores.

Estado:

```txt
Cierre de caja con filtros ✅
Limpieza de cierre de prueba ✅
```

---

## 14. Estado general validado

Módulos operativos en Vercel:

| Módulo | Estado |
|---|---|
| Login por usuario | Validado ✅ |
| Roles básicos | Validado ✅ |
| Menú por rol | Validado ✅ |
| Dashboard | Validado ✅ |
| Dashboard con filtros por periodo/sede | Validado ✅ |
| Citas de hoy | Validado ✅ |
| Nueva atención | Validado ✅ |
| Registrar salida | Validado ✅ |
| Comprobantes editables | Validado ✅ |
| Cierre de caja | Validado ✅ |

---

## 15. Pendientes recomendados para la siguiente fase

Orden sugerido:

1. **Checkpoint técnico en GitHub**  
   Guardar este documento en `docs/`.

2. **Permisos finos por rol**  
   No solo ocultar links, también bloquear rutas y acciones según rol.

3. **Perfil de cliente**  
   Ver historial por WhatsApp / DNI / nombre.

4. **Mejorar Citas de hoy**  
   Acciones rápidas: cobrar, marcar boleta, editar atención, ver cliente.

5. **Reportes para socios**  
   Vista limpia con filtros por mes, sede, comprobantes, salidas y neto.

6. **Auditoría de cambios**  
   Registrar quién modifica comprobantes, cierres o movimientos.

7. **Panel WhatsApp futuro**  
   Recién después de consolidar Caja.

---

## 16. Consultas SQL útiles de validación

### Ver cierres por fecha y sede

```sql
select
  cierre_id,
  fecha,
  sede,
  caja_inicial,
  efectivo_contado,
  pozo_fondo,
  total_ingresos,
  total_salidas,
  caja_esperada,
  diferencia,
  pax_total,
  boletas_pendientes,
  responsable,
  estado,
  observacion,
  created_at
from public.caja_cierres
where fecha = '2026-07-06'
  and sede = 'Miraflores'
order by created_at desc;
```

### Contar cierres por fecha y sede

```sql
select
  count(*) as cierres
from public.caja_cierres
where fecha = '2026-07-06'
  and sede = 'Miraflores';
```

### Ver usuarios activos

```sql
select
  id,
  usuario,
  pin,
  rol,
  nombre,
  activo,
  nota,
  created_at,
  updated_at
from public.usuarios
where activo = true
order by id;
```

### Ver movimientos de prueba

```sql
select *
from public.caja_movimientos
where cliente in ('PRUEBA SISTEMA', 'PRUEBA COMPROBANTE')
   or whatsapp in ('999999999', '999999998');
```

---

## 17. Decisión técnica vigente

Se continúa en **Vercel + Supabase**.

Motivo:

- Ya funciona.
- No hay urgencia de migrar a Contabo.
- Vercel simplifica deploy desde GitHub.
- Contabo puede quedar para n8n, servicios internos o futuro backend propio.

Criterio futuro:

Migrar a VPS solo si Vercel cobra de forma innecesaria, si se requieren procesos persistentes, o si el proyecto necesita control total de servidor.

---

## 18. Próximo paso recomendado

Antes de seguir programando, subir este checkpoint a GitHub:

```txt
docs/CHECKPOINT_FASE_OPERATIVA_2026_07_07.md
```

Commit sugerido:

```txt
docs: add operative phase checkpoint
```

Después continuar con:

```txt
Permisos finos por rol
```


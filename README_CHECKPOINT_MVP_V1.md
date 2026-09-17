# Caja Vita Lima — Checkpoint MVP V1

Este archivo resume el checkpoint técnico del MVP V1 y se mantiene como referencia histórica. La implementación activa de la conciliación final V2 se desarrolla de forma aislada en `feat/conciliacion-atencion-v2` y no modifica el significado histórico de este checkpoint.

## Conciliación final V2 — estado de la rama

La rama V2 añade, sin merge ni despliegue:

- pagos múltiples por atención;
- extras/upselling auditables;
- descuentos, cortesías y ajustes con motivo;
- coberturas Gift Card, Bee Beneficios y Cuponidad;
- propinas separadas de ingresos Vita Lima y distribuidas a terapistas;
- RPC `conciliar_atencion_v2` incremental, transaccional e idempotente;
- harness PostgreSQL con `ROLLBACK` para casuísticas reales;
- cierre de caja con snapshots separados de `total_ingresos`, `total_propinas` y `total_procesado`.

Las migraciones V2 (`034`, `035`, `036`) no se consideran aplicadas hasta que se ejecuten explícitamente en un entorno autorizado y pasen QA.

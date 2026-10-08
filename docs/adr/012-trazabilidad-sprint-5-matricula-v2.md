# ADR 012: Trazabilidad del Sprint 5, Matrícula v2 y consolidación

## Estado

Aceptado. Las migraciones 016 a 022 están aplicadas en el proyecto real de
Supabase.

## Contexto

Según la planificación inicial y los comentarios del código, el Sprint 5
correspondía a RF-04 (pagos con Kushki, historial de pagos y cuotas). La
auditoría del 29/09/2026 (flujo online, asistencia del instructor y lote CD-05
a CD-07) reorientó el trabajo hacia ampliar y rediseñar la matrícula manual
(RF-01), corregir la integridad de las prácticas del Sprint 4 (RF-03) y
habilitar el módulo de instructores. El resultado es un conjunto de ramas
apiladas que no corresponde al alcance planificado y que mezcla trabajo con
orígenes distintos.

## Decisión

1. El Sprint 5 pasa a denominarse **Matrícula v2 y consolidación** y amplía
   RF-01. Se publica con una sola etiqueta, `v0.5.0`, en el repositorio
   backend y en el frontend, que se crea únicamente cuando se apruebe la
   fusión.
2. RF-04 (Kushki, historial de pagos y cuotas) se traslada al Sprint 6.
3. Cada rama se clasifica por tipo de cambio, requisito y sprint de origen
   para que el historial de fusiones sea trazable. Las ramas forman una
   cadena lineal sobre `main`; se fusionan en este orden:

| # | Rama | Tipo | RF | Migraciones | Sprint de origen |
|---|------|------|----|-------------|------------------|
| 1 | `feature/datos-estudiante-ampliados` | Funcionalidad nueva | Extensión de RF-01 | 016, 017 | 5 |
| 2 | `chore/runtime-node-22` | Mantenimiento transversal | Ninguno | Ninguna | Transversal |
| 3 | `feature/cd-05-07-integridad-practicas` | Corrección del Sprint 4 | RF-03 | 018, 019 | 4 |
| 4 | `feature/matricula-manual-simplificada` | Rediseño | RF-01 | 020 | 2 |
| 5 | `feature/modulo-instructores` | Funcionalidad nueva | Soporte de RF-03 | 021 | 5 |
| 6 | `feature/matricula-documentos-abono` | Funcionalidad nueva | Extensión de RF-01; antesala de RF-04 | 022 | 5 |

Las migraciones 016 a 022 ya están aplicadas en el proyecto real de Supabase,
por lo que fusionar estas ramas no requiere ejecutarlas de nuevo. Los archivos
del repositorio son el registro versionado de lo ya aplicado.

El ADR 011 indica que la migración 022 se entrega para revisión y no se aplica
desde el repositorio. Esa nota queda superada: la 022 está aplicada.

## Consecuencias

- El alcance de RF-04 no se entregó en el Sprint 5 y queda como la parte
  principal del Sprint 6.
- La rama 4 contiene el rediseño de una funcionalidad del Sprint 2; la rama 3
  corrige una entrega del Sprint 4. Ambas se fusionan en el Sprint 5 pero se
  atribuyen a su sprint de origen.
- El checklist de documentos y el abono inicial (rama 6) se diseñaron para ser
  importados como saldo de apertura cuando exista el historial de pagos
  (ADR 011).

## Pendientes

- Asistencia del instructor en la interfaz de usuario.
- Asignación tardía de cohorte con abono: al asignar cohorte a una matrícula
  en `pendiente_cohorte`, calcular el neto y rechazar la asignación si el
  abono lo supera (ADR 011).
- Pantalla de reconciliación de matrículas con resultado incierto y gestión de
  pendientes de cohorte.
- RF-04: integración con Kushki, historial de pagos y cuotas (Sprint 6).
- Despliegue: fusionar y desplegar toda la cadena backend en conjunto, con
  Railway en Node 22, porque el esquema real ya incluye 016–022.

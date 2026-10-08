# ADR 011: Checklist y abono inicial de matrícula manual

## Estado

Aceptado para la migración 022. La migración se entrega para revisión; no se
aplica desde el repositorio.

## Decisión

Cada matrícula tiene cuatro filas en `enrollment_documents`, una por documento
del catálogo cerrado. `pendiente` es el valor inicial; la papeleta nace
`no_aplica` si el estudiante ya cumplió 65 años según `fecha_nacimiento`.
Sin fecha de nacimiento queda `pendiente` y el administrador puede editarla.
El checklist es informativo y no bloquea otras operaciones. `fecha_marcado` y
`marcado_por` registran las marcas explícitas del administrador; las marcas
automáticas y los valores iniciales carecen de actor.

`monto_total` conserva el significado de 017: precio **neto** de la cohorte
después del descuento. Para una matrícula con cohorte, `monto_total =
cohorts.precio - descuento`, `saldo = monto_total - monto_abonado`, y
`0 <= monto_abonado <= monto_total`. El pago completo exige que el abono iguale
el neto. El precio bruto mostrado se deriva como `monto_total + descuento`.

En `pendiente_cohorte`, `monto_total` y `saldo` son nulos y `descuento = 0`.
`monto_abonado` puede ser cualquier importe no negativo: se registra el dinero
recibido aunque todavía no exista precio. El futuro módulo que asigne cohorte
deberá calcular el neto y rechazar la asignación si el abono lo supera.

`monto_abonado` es un importe inicial corregible, no un historial. Cuando se
incorpore un historial de pagos, este importe se importará una sola vez como
saldo de apertura identificado por matrícula. Desde ese momento el cálculo
contable no lo sumará por separado a las entradas importadas.

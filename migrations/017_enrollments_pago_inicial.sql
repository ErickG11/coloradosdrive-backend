-- 017_enrollments_pago_inicial.sql
-- Alcance deliberadamente mínimo: captura el pago inicial al matricular
-- (descuento aplicado y cuánto se abonó en el momento), sentando la base
-- para un futuro módulo de estado de cuenta (RF-06). NO es el sistema de
-- pagos por cuotas (eso es Kushki, Sprint 5, aparte) — un historial de
-- pagos múltiples a lo largo del curso es un módulo futuro separado, que
-- partirá de estas dos columnas, no las reemplaza.

begin;

alter table enrollments
  add column descuento numeric not null default 0,
  add column monto_abonado numeric not null default 0;

-- monto_abonado <= monto_total: con monto_total NULL (pendiente_cohorte,
-- ver migración 014), la comparación evalúa a NULL y el check la deja
-- pasar sin más — coherente con que ahí monto_abonado se queda en su
-- default (0): no hay total del que abonar una parte todavía.
alter table enrollments
  add constraint enrollments_descuento_no_negativo check (descuento >= 0),
  add constraint enrollments_monto_abonado_valido check (
    monto_abonado >= 0 and monto_abonado <= monto_total
  );

comment on column enrollments.descuento is
  'Descuento aplicado sobre el precio de la cohorte al matricular; monto_total ya sale con este descuento restado.';
comment on column enrollments.monto_abonado is
  'Monto abonado al momento de matricular (igual a monto_total si pagó todo, menor si abonó una parte). Dato inicial para el futuro módulo de historial de pagos — no es ese historial.';

commit;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const VENTANA_DIAS = 7;
const RANGO_CORTO_MAX_DIAS = 14;

function diasEntre(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / MS_PER_DAY);
}

/**
 * Color de una franja según su posición dentro del rango completo
 * (rangeMin..rangeMax) de franjas asignadas/confirmadas del mismo
 * estudiante en la misma cohorte. Asume que rangeMin <= scheduledAt <=
 * rangeMax (garantizado si scheduledAt es una de las franjas usadas para
 * calcular el propio rango).
 *
 * - Rango corto (<= 14 días de punta a punta): siempre 'amarillo' - nunca
 *   debe quedar sin color por un rango que cabe entero en "primeros 7" +
 *   "últimos 7".
 * - Primeros 7 días del rango: 'rojo' (recién empieza).
 * - Últimos 7 días del rango: 'amarillo' (acabando).
 * - El resto (solo posible si el rango total > 14 días): 'neutro'.
 */
export function computeColorSemana(
  scheduledAt: Date,
  rangeMin: Date,
  rangeMax: Date,
): 'rojo' | 'amarillo' | 'neutro' {
  const totalDias = diasEntre(rangeMax, rangeMin);
  if (totalDias <= RANGO_CORTO_MAX_DIAS) {
    return 'amarillo';
  }

  const diasDesdeInicio = diasEntre(scheduledAt, rangeMin);
  if (diasDesdeInicio < VENTANA_DIAS) {
    return 'rojo';
  }

  const diasHastaFin = diasEntre(rangeMax, scheduledAt);
  if (diasHastaFin < VENTANA_DIAS) {
    return 'amarillo';
  }

  return 'neutro';
}

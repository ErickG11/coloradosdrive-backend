import { DateTime } from 'luxon';

export const COHORT_MINIMUM_DAYS = 5;
export function schoolDaysBetween(from: Date, to: Date): number {
  const day = (date: Date): DateTime => DateTime.fromJSDate(date).setZone('America/Guayaquil').startOf('day');
  return Math.round(day(to).diff(day(from), 'days').days);
}
// La apertura de matrícula no limita una solicitud anticipada.
export function qualifiesForCohort(requestedAt: Date, closesAt: Date, occupied: number, capacity: number): boolean {
  return occupied < capacity && schoolDaysBetween(requestedAt, closesAt) >= COHORT_MINIMUM_DAYS;
}

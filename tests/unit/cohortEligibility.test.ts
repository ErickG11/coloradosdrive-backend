import { qualifiesForCohort, schoolDaysBetween } from '../../src/utils/cohortEligibility';
const day = (value: string) => new Date(`${value}T05:00:00Z`);
it.each([
  ['2026-11-09', false], ['2026-11-11', true], ['2026-11-10', true],
])('solicitud el 5 y cierre %s', (close, expected) => {
  expect(qualifiesForCohort(day('2026-11-05'), day(close), 0, 20)).toBe(expected);
});
it('rechaza cupo completo y respeta el cambio de día de Guayaquil', () => {
  expect(qualifiesForCohort(day('2026-11-05'), day('2026-11-11'), 20, 20)).toBe(false);
  expect(schoolDaysBetween(new Date('2026-11-06T04:59:00Z'), day('2026-11-10'))).toBe(5);
  expect(schoolDaysBetween(new Date('2026-11-06T05:00:00Z'), day('2026-11-10'))).toBe(4);
});

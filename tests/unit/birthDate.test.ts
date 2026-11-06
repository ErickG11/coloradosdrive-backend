import { DateTime } from 'luxon';
import {
  BIRTH_DATE_CODES,
  BIRTH_DATE_CODE_BY_MESSAGE,
  BIRTH_DATE_MESSAGES,
  ENFORCE_LEGAL_MIN_AGE,
  LEGAL_MIN_AGE,
  ageOn,
  assertBirthDate,
  birthDateError,
} from '../../src/utils/birthDate';

// 2026-10-21 12:00 en Guayaquil.
const now = DateTime.fromISO('2026-10-21T12:00:00', { zone: 'America/Guayaquil' });

describe('fecha de nacimiento compartida', () => {
  it.each([
    ['2000-02-29', null],
    ['2011-10-21', null], // exactamente 15 años hoy
    ['1926-10-21', null], // exactamente 100 años hoy
    ['2011-10-22', BIRTH_DATE_MESSAGES.edadMinima], // le falta un día para cumplir 15
    ['2010-10-21', null], // 16 años: sigue siendo válido
    ['1926-10-20', null], // cumplió 100 ayer: 100 sigue siendo válido
    ['1925-10-22', null], // 100 años y 364 días: aún tiene 100
    ['1925-10-21', BIRTH_DATE_MESSAGES.edadMaxima], // cumple 101 hoy
    ['2026-10-21', BIRTH_DATE_MESSAGES.edadMinima], // hoy: 0 años, cae en «menor de la edad mínima»
    ['2026-10-20', BIRTH_DATE_MESSAGES.edadMinima], // ayer
    ['2026-10-22', BIRTH_DATE_MESSAGES.futura], // mañana
    ['2999-01-01', BIRTH_DATE_MESSAGES.futura],
    ['2026-02-30', BIRTH_DATE_MESSAGES.invalida],
    ['0000-01-01', BIRTH_DATE_MESSAGES.invalida],
    ['2000-1-1', BIRTH_DATE_MESSAGES.invalida],
    ['2000-01-01T00:00:00Z', BIRTH_DATE_MESSAGES.invalida],
    [20000101, BIRTH_DATE_MESSAGES.invalida],
  ])('%s -> %s', (value, expected) => {
    expect(birthDateError(value, now)).toBe(expected);
  });

  it('usa el día de Guayaquil: a las 23:30 locales (04:30 UTC del día siguiente) hoy sigue siendo hoy', () => {
    const lateLocal = DateTime.fromISO('2026-10-21T23:30:00', { zone: 'America/Guayaquil' });
    expect(lateLocal.toUTC().toISODate()).toBe('2026-10-22');
    expect(birthDateError('2026-10-21', lateLocal)).toBe(BIRTH_DATE_MESSAGES.edadMinima); // hoy en Guayaquil
    expect(birthDateError('2026-10-22', lateLocal)).toBe(BIRTH_DATE_MESSAGES.futura); // mañana en Guayaquil
  });

  it('calcula la edad cumplida', () => {
    expect(ageOn('2000-10-21', '2026-10-21')).toBe(26);
    expect(ageOn('2000-10-22', '2026-10-21')).toBe(25);
  });

  it('la edad legal mínima de 18 está desactivada (se reporta, no se aplica)', () => {
    expect(LEGAL_MIN_AGE).toBe(18);
    expect(ENFORCE_LEGAL_MIN_AGE).toBe(false);
    expect(birthDateError('2009-01-01', now)).toBeNull(); // 17 años: pasa mientras no se active
  });

  it('assertBirthDate lanza el mensaje para express-validator', () => {
    expect(assertBirthDate('2000-01-01')).toBe(true);
    expect(() => assertBirthDate('2999-01-01')).toThrow(BIRTH_DATE_MESSAGES.futura);
  });

  it('un mensaje literal y un code distinto por caso', () => {
    expect(BIRTH_DATE_MESSAGES.futura).toBe('La fecha de nacimiento no puede ser futura.');
    expect(BIRTH_DATE_MESSAGES.edadMinima).toBe('La edad mínima para registrar a un estudiante es de 15 años.');
    expect(BIRTH_DATE_MESSAGES.edadMaxima).toBe('La edad máxima permitida es de 100 años.');
    const codes = new Set(Object.values(BIRTH_DATE_CODES));
    expect(codes.size).toBe(Object.values(BIRTH_DATE_CODES).length);
    expect(BIRTH_DATE_CODE_BY_MESSAGE[BIRTH_DATE_MESSAGES.futura]).toBe('BIRTH_DATE_FUTURE');
    expect(BIRTH_DATE_CODE_BY_MESSAGE[BIRTH_DATE_MESSAGES.edadMinima]).toBe('BIRTH_DATE_TOO_YOUNG');
    expect(BIRTH_DATE_CODE_BY_MESSAGE[BIRTH_DATE_MESSAGES.edadMaxima]).toBe('BIRTH_DATE_TOO_OLD');
  });
});

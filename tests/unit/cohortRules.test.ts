import { DateTime } from 'luxon';

import type { AppError } from '../../src/utils/AppError';
import {
  assertCohortDates,
  isFechaCivil,
  maxCohortDate,
  normalizeCohortName,
  withCount,
  type CohortDates,
} from '../../src/utils/cohortRules';

describe('isFechaCivil', () => {
  it.each(['2026-02-28', '2028-02-29', '2020-01-01', '0001-01-01'])('acepta %s', (value) => {
    expect(isFechaCivil(value)).toBe(true);
  });

  it.each([
    '2026-02-30',
    '2026-13-01',
    '2026-2-1',
    '0000-01-01',
    '2026-02-01T00:00:00Z',
    '',
    'abc',
    null,
    20260201,
  ])('rechaza %p', (value) => {
    expect(isFechaCivil(value)).toBe(false);
  });
});

describe('maxCohortDate', () => {
  it('suma 5 años a la fecha de hoy en la zona de la escuela', () => {
    expect(maxCohortDate(DateTime.fromISO('2026-10-19T15:00:00Z'))).toBe('2031-10-19');
  });

  it('usa el día de Ecuador, no el de UTC (02:00 UTC sigue siendo el día anterior)', () => {
    expect(maxCohortDate(DateTime.fromISO('2026-10-20T02:00:00Z'))).toBe('2031-10-19');
  });

  it('resuelve el 29 de febrero hacia el 28 cuando el año destino no es bisiesto', () => {
    expect(maxCohortDate(DateTime.fromISO('2028-02-29T15:00:00Z'))).toBe('2033-02-28');
  });
});

describe('assertCohortDates', () => {
  const base: CohortDates = {
    fechaInicioMatricula: '2026-02-01',
    fechaFinMatricula: '2026-02-25',
    fechaInicioCurso: '2026-03-01',
    fechaFinCurso: '2026-06-01',
  };

  function failure(dates: Partial<CohortDates>): AppError {
    try {
      assertCohortDates({ ...base, ...dates });
    } catch (error) {
      return error as AppError;
    }
    throw new Error('Se esperaba un error');
  }

  it('acepta ventanas válidas, incluido que la matrícula cierre después de que empiece el curso', () => {
    expect(() => {
      assertCohortDates(base);
    }).not.toThrow();
    expect(() => {
      assertCohortDates({ ...base, fechaFinMatricula: '2026-03-20' });
    }).not.toThrow();
    expect(() => {
      assertCohortDates({
        fechaInicioMatricula: '2026-02-01',
        fechaFinMatricula: '2026-02-01',
        fechaInicioCurso: '2026-02-01',
        fechaFinCurso: '2026-02-01',
      });
    }).not.toThrow();
  });

  it('rechaza el fin de matrícula anterior al inicio', () => {
    expect(failure({ fechaFinMatricula: '2026-01-31' })).toMatchObject({
      statusCode: 400,
      message: 'El fin de matrícula no puede ser anterior al inicio de matrícula.',
      code: 'INVALID_FIELD',
      field: 'fechaFinMatricula',
    });
  });

  it('rechaza el fin de curso anterior al inicio', () => {
    expect(failure({ fechaFinCurso: '2026-02-28' })).toMatchObject({
      message: 'El fin de curso no puede ser anterior al inicio de curso.',
      field: 'fechaFinCurso',
    });
  });

  it('rechaza un curso que termina antes de que abra la matrícula', () => {
    expect(failure({ fechaInicioCurso: '2026-01-01', fechaFinCurso: '2026-01-31' })).toMatchObject({
      message: 'El curso no puede terminar antes de que abra la matrícula.',
      field: 'fechaFinCurso',
    });
  });
});

describe('normalizeCohortName', () => {
  it('ignora mayúsculas y espacios extremos (como lower(btrim(nombre)))', () => {
    expect(normalizeCohortName('  TA-23001 ')).toBe('ta-23001');
    expect(normalizeCohortName('Cohorte  A')).toBe('cohorte  a');
  });
});

describe('withCount', () => {
  it('añade el conteo entre paréntesis antes del punto final', () => {
    expect(withCount('La cohorte tiene alumnos asociados.', 3)).toBe(
      'La cohorte tiene alumnos asociados (3).',
    );
  });
});

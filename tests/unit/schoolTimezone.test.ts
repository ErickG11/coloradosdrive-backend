import { AppError } from '../../src/utils/AppError';
import {
  formatHora,
  parseFechaCivil,
  parseHora,
  toScheduledAtUTC,
} from '../../src/utils/schoolTimezone';

describe('parseHora / formatHora', () => {
  it('parsea horas válidas', () => {
    expect(parseHora('06:00')).toEqual({ hour: 6, minute: 0 });
    expect(parseHora('21:45')).toEqual({ hour: 21, minute: 45 });
  });

  it('formatea de vuelta con ceros a la izquierda', () => {
    expect(formatHora({ hour: 6, minute: 0 })).toBe('06:00');
    expect(formatHora({ hour: 21, minute: 5 })).toBe('21:05');
  });

  it.each(['6:00', '24:00', '12:60', 'abc', '', '12:5'])(
    'rechaza formato inválido (%p)',
    (value) => {
      expect(() => parseHora(value)).toThrow(AppError);
    },
  );
});

describe('parseFechaCivil', () => {
  it('parsea una fecha válida', () => {
    const fecha = parseFechaCivil('2026-03-02');
    expect(fecha.toFormat('yyyy-LL-dd')).toBe('2026-03-02');
  });

  it.each(['2026-13-01', '2026-02-30', '02-03-2026', ''])(
    'rechaza fecha inválida (%p)',
    (value) => {
      expect(() => parseFechaCivil(value)).toThrow(AppError);
    },
  );
});

describe('toScheduledAtUTC — America/Guayaquil es UTC-5 fijo', () => {
  it('convierte 15:00 local a 20:00 UTC', () => {
    const fecha = parseFechaCivil('2026-03-02');
    expect(toScheduledAtUTC(fecha, { hour: 15, minute: 0 })).toBe('2026-03-02T20:00:00.000Z');
  });

  it('un bloque tarde (21:00 local) cruza al día UTC siguiente sin romper nada', () => {
    const fecha = parseFechaCivil('2026-03-02');
    expect(toScheduledAtUTC(fecha, { hour: 21, minute: 0 })).toBe('2026-03-03T02:00:00.000Z');
  });

  it('no aplica horario de verano en ninguna época del año (Ecuador no tiene DST)', () => {
    const enero = parseFechaCivil('2026-01-15');
    const julio = parseFechaCivil('2026-07-15');
    expect(toScheduledAtUTC(enero, { hour: 15, minute: 0 })).toBe('2026-01-15T20:00:00.000Z');
    expect(toScheduledAtUTC(julio, { hour: 15, minute: 0 })).toBe('2026-07-15T20:00:00.000Z');
  });
});

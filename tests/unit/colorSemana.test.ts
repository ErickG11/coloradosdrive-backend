import { computeColorSemana } from '../../src/utils/colorSemana';

const d = (day: number): Date => new Date(`2026-03-${String(day).padStart(2, '0')}T15:00:00Z`);

describe('computeColorSemana', () => {
  it('rango corto (<= 14 días de punta a punta) siempre es amarillo, sin importar la posición', () => {
    const min = d(1);
    const max = d(15); // 14 días de diferencia
    expect(computeColorSemana(min, min, max)).toBe('amarillo');
    expect(computeColorSemana(d(8), min, max)).toBe('amarillo'); // "medio" de un rango corto
    expect(computeColorSemana(max, min, max)).toBe('amarillo');
  });

  it('un solo día (min === max) es amarillo', () => {
    const unico = d(10);
    expect(computeColorSemana(unico, unico, unico)).toBe('amarillo');
  });

  it('rango largo (> 14 días): primeros 7 días son rojo', () => {
    const min = d(1);
    const max = d(30); // 29 días
    expect(computeColorSemana(min, min, max)).toBe('rojo');
    expect(computeColorSemana(d(7), min, max)).toBe('rojo'); // día 6 desde el inicio (< 7)
  });

  it('rango largo: últimos 7 días son amarillo', () => {
    const min = d(1);
    const max = d(30);
    expect(computeColorSemana(max, min, max)).toBe('amarillo');
    expect(computeColorSemana(d(24), min, max)).toBe('amarillo'); // 6 días antes del fin
  });

  it('rango largo: el tramo intermedio es neutro', () => {
    const min = d(1);
    const max = d(30);
    expect(computeColorSemana(d(15), min, max)).toBe('neutro');
  });

  it('límite exacto: día 7 desde el inicio ya no es rojo (es neutro, si el rango lo permite)', () => {
    const min = d(1);
    const max = d(30);
    expect(computeColorSemana(d(8), min, max)).toBe('neutro'); // exactamente 7 días desde min
  });

  it('límite exacto: 15 días de rango total ya cuenta como "largo" (> 14)', () => {
    const min = d(1);
    const max = d(16); // 15 días de diferencia
    expect(computeColorSemana(min, min, max)).toBe('rojo');
    expect(computeColorSemana(max, min, max)).toBe('amarillo');
  });
});

// Horas de práctica por día de un plan (una franja = 1 hora). Fuente única
// del rango; antes era 1-16 repetido en tres sitios.
export const HORAS_POR_DIA_MIN = 1;
export const HORAS_POR_DIA_MAX = 6;
export const HORAS_POR_DIA_MESSAGE = 'Las horas por día deben ser un entero entre 1 y 6.';

export function isHorasPorDiaValid(value: unknown): boolean {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= HORAS_POR_DIA_MIN &&
    value <= HORAS_POR_DIA_MAX
  );
}

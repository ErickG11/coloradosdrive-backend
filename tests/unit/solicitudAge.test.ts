import { calcularEdad, validateApplicant } from '../../src/utils/solicitudAge';
const now = new Date('2026-10-29T03:00:00Z'); // Todavía 28 en Guayaquil.
it('usa el cumpleaños en Guayaquil para el mínimo', () => {
  expect(calcularEdad('2011-10-29', now)).toBe(14);
  expect(() => validateApplicant('2011-10-29', undefined, now)).toThrow(expect.objectContaining({ code: 'EDAD_MINIMA' }));
});
it('exige representante de 15 a 17 y valida su cédula', () => {
  expect(() => validateApplicant('2010-01-01', { nombre: 'R', cedula: '1710034064', acepta: true }, now)).toThrow(expect.objectContaining({ code: 'REPRESENTANTE_REQUERIDO' }));
  expect(validateApplicant('2010-01-01', { nombre: ' R ', cedula: '1710034065', acepta: true }, now)).toEqual({ nombre: 'R', cedula: '1710034065', acepta: true });
  expect(validateApplicant('2008-10-28', undefined, now)).toBeNull();
});

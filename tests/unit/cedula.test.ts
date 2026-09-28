import { isValidCedulaEcuatoriana } from '../../src/utils/cedula';

describe('isValidCedulaEcuatoriana', () => {
  it.each(['1710034065', '1713175071'])('acepta la cédula válida %s', (cedula) => {
    expect(isValidCedulaEcuatoriana(cedula)).toBe(true);
  });

  it('rechaza un dígito verificador incorrecto', () => {
    expect(isValidCedulaEcuatoriana('1710034064')).toBe(false);
  });

  it.each(['', '171003406', '17100340650', '17100340a5', '1710 34065'])(
    'rechaza formato inválido (%p)',
    (cedula) => {
      expect(isValidCedulaEcuatoriana(cedula)).toBe(false);
    },
  );

  it('rechaza una provincia fuera de 01-24 y distinta de 30', () => {
    expect(isValidCedulaEcuatoriana('2510034065')).toBe(false);
    expect(isValidCedulaEcuatoriana('0010034065')).toBe(false);
  });

  it('rechaza un tercer dígito >= 6 (no es persona natural)', () => {
    expect(isValidCedulaEcuatoriana('1760034065')).toBe(false);
  });
});

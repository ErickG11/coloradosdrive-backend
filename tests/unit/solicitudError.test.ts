import { AppError } from '../../src/utils/AppError';
import { solicitudError, solicitudErrorCode } from '../../src/utils/solicitudError';

describe('errores estables de solicitudes', () => {
  it.each([
    ['Código inválido o vencido', 400, 'CODIGO_INVALIDO_O_VENCIDO'],
    ['Demasiados intentos fallidos. Solicita un nuevo código', 429, 'INTENTOS_AGOTADOS'],
    ['Demasiadas solicitudes', 429, 'LIMITE_PETICIONES'],
    ['Ya existe una solicitud aprobada para este correo', 409, 'CORREO_YA_APROBADO'],
  ])('clasifica %s', (message, status, code) => {
    expect(solicitudErrorCode(new AppError(message, status))).toBe(code);
  });
  it('no expone errores del proveedor y conserva códigos explícitos', () => {
    expect(solicitudErrorCode(new Error('detalle privado'))).toBe('ERROR_INTERNO');
    expect(solicitudErrorCode(solicitudError('Aviso', 409, 'AVISO_DESACTUALIZADO'))).toBe('AVISO_DESACTUALIZADO');
  });
});

import { uniformVerification } from '../../src/utils/uniformVerification';
import { AppError } from '../../src/utils/AppError';
const logs = jest.spyOn(console, 'error').mockImplementation(() => undefined);
afterAll(() => {
  logs.mockRestore();
});
beforeEach(() => {
  logs.mockClear();
});
test('piso de 300ms para trabajo rápido', async () => {
  const now = jest.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1020),
    wait = jest.fn().mockResolvedValue(undefined);
  await uniformVerification(() => Promise.resolve(), { now, wait });
  expect(wait).toHaveBeenCalledWith(280);
});
test.each([300, 500, 2000])('si el trabajo tarda %ims no añade demora', async (elapsed) => {
  const now = jest
      .fn()
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000 + elapsed),
    wait = jest.fn();
  await uniformVerification(() => Promise.resolve(), { now, wait });
  expect(wait).not.toHaveBeenCalled();
});
test('los errores de cuenta/duplicado/proveedor son éxito genérico y no se registran datos', async () => {
  for (const error of [
    new AppError('correo privado', 409, { code: 'CORREO_EXISTENTE' }),
    new Error('IP secreta y token'),
    new AppError('curso no existe', 404),
  ]) {
    const now = () => 0,
      wait = jest.fn().mockResolvedValue(undefined);
    await expect(
      uniformVerification(() => Promise.reject(error), { now, wait }),
    ).resolves.toBeUndefined();
    expect(wait).toHaveBeenCalledWith(300);
  }
  expect(logs.mock.calls).toEqual(
    Array(3).fill([JSON.stringify({ event: 'verification_request_failed' })]),
  );
});
test.each([
  'INSCRIPCIONES_CERRADAS',
  'CUPO_DIARIO_AGOTADO',
  'CAPTCHA_INVALIDO',
  'VERIFICACION_NO_DISPONIBLE',
])('preserva rechazo permitido %s y espera piso', async (code) => {
  const error = new AppError('Mensaje seguro', 429, { code }),
    wait = jest.fn().mockResolvedValue(undefined);
  await expect(
    uniformVerification(() => Promise.reject(error), { now: () => 0, wait }),
  ).rejects.toBe(error);
  expect(wait).toHaveBeenCalledWith(300);
  expect(logs).not.toHaveBeenCalled();
});

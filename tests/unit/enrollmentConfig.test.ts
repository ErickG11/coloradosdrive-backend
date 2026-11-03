import { loadEnrollmentConfig } from '../../src/config/enrollmentConfig';
const source = {
  NODE_ENV: 'test',
  SOLICITUD_TOKEN_SECRET: 'secreto-ficticio-solo-pruebas-con-32-caracteres',
};
test('defaults de configuración sin exigir variables adicionales a tests/setupEnv', () => {
  expect(loadEnrollmentConfig(source)).toMatchObject({
    ENROLLMENT_CODES_DAILY_CAP: 250,
    ENROLLMENT_NEW_REQUESTS_DAILY_CAP: 150,
    ENROLLMENT_UPLOADS_DAILY_CAP: 40,
    ENROLLMENT_UPLOADS_PER_IP_DAILY_CAP: 5,
    ENROLLMENT_CODES_PER_IP_HOUR: 60,
    RECENT_GRAD_MONTHS: 12,
    CAPTCHA_PROVIDER: 'off',
    ADMIN_MFA_REQUIRED: false,
  });
});
test.each([
  'ENROLLMENT_CODES_DAILY_CAP',
  'ENROLLMENT_NEW_REQUESTS_DAILY_CAP',
  'ENROLLMENT_UPLOADS_DAILY_CAP',
  'ENROLLMENT_UPLOADS_PER_IP_DAILY_CAP',
  'ENROLLMENT_CODES_PER_IP_HOUR',
])('%s permite cero y rechaza valores ambiguos', (key) => {
  expect(loadEnrollmentConfig({ ...source, [key]: '0' })).toHaveProperty(key, 0);
  for (const value of ['-1', '1.5', 'NaN', 'Infinity', '1000001', '1e3'])
    expect(() => loadEnrollmentConfig({ ...source, [key]: value })).toThrow(key);
});
test.each(['0', '121', '1.5'])('RECENT_GRAD_MONTHS rechaza %s', (value) => {
  expect(() => loadEnrollmentConfig({ ...source, RECENT_GRAD_MONTHS: value })).toThrow(
    'RECENT_GRAD_MONTHS',
  );
});
test('MFA solo admite booleanos explícitos', () => {
  expect(loadEnrollmentConfig({ ...source, ADMIN_MFA_REQUIRED: 'true' }).ADMIN_MFA_REQUIRED).toBe(
    true,
  );
  expect(() => loadEnrollmentConfig({ ...source, ADMIN_MFA_REQUIRED: 'yes' })).toThrow(
    'ADMIN_MFA_REQUIRED',
  );
});
test('HMAC admite secreto dedicado, nunca imprime el valor inválido', () => {
  const dedicated = 'otro-secreto-ficticio-dedicado-con-32-caracteres';
  expect(
    loadEnrollmentConfig({ ...source, ENROLLMENT_RATE_HMAC_SECRET: dedicated })
      .ENROLLMENT_RATE_HMAC_SECRET,
  ).toBe(dedicated);
  expect(() => loadEnrollmentConfig({ ...source, ENROLLMENT_RATE_HMAC_SECRET: 'corto' })).toThrow(
    'debe tener al menos 32',
  );
});
test('proveedor captcha inválido falla; producción selecciona Turnstile por defecto', () => {
  expect(loadEnrollmentConfig({ ...source, NODE_ENV: 'production' }).CAPTCHA_PROVIDER).toBe(
    'turnstile',
  );
  expect(() => loadEnrollmentConfig({ ...source, CAPTCHA_PROVIDER: 'desconocido' })).toThrow(
    'CAPTCHA_PROVIDER',
  );
});
test('versiones configurables y política neutra de reembolso con longitud limitada', () => {
  expect(
    loadEnrollmentConfig({
      ...source,
      PRIVACY_NOTICE_VERSION: 'aviso-test',
      TERMS_VERSION: 'terminos-test',
    }),
  ).toMatchObject({ PRIVACY_NOTICE_VERSION: 'aviso-test', TERMS_VERSION: 'terminos-test' });
  expect(loadEnrollmentConfig(source).TERMS_REFUND_TEXT).toContain('revisión legal');
  expect(() => loadEnrollmentConfig({ ...source, TERMS_REFUND_TEXT: 'a'.repeat(2001) })).toThrow(
    'TERMS_REFUND_TEXT',
  );
});

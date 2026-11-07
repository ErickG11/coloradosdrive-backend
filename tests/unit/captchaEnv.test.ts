export {};
jest.mock('dotenv', () => ({ config: jest.fn() }));
const previous = { ...process.env };
afterEach(() => {
  process.env = { ...previous };
});
function read(): void {
  jest.isolateModules(() => {
    jest.requireActual('../../src/config/env');
  });
}
test('arranque real rechaza off en producción', () => {
  process.env.NODE_ENV = 'production';
  process.env.CAPTCHA_PROVIDER = 'off';
  expect(read).toThrow('CAPTCHA_PROVIDER=off está prohibido');
});
test.each(['TURNSTILE_SECRET_KEY', 'NEXT_PUBLIC_TURNSTILE_SITE_KEY'])(
  'arranque real exige %s para Turnstile',
  (field) => {
    process.env.NODE_ENV = 'production';
    process.env.CAPTCHA_PROVIDER = 'turnstile';
    process.env[field] = '';
    expect(read).toThrow(`requiere ${field}`);
  },
);
test('arranque real mantiene off local sin claves', () => {
  process.env.NODE_ENV = 'test';
  process.env.CAPTCHA_PROVIDER = 'off';
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  expect(read).not.toThrow();
});

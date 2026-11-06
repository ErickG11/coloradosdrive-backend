import type * as EnvModule from '../../src/config/env';

jest.mock('dotenv', () => ({ config: jest.fn() }));

describe('configuración por proveedor de correo', () => {
  const previous = { ...process.env };
  beforeEach(() => {
    process.env = { ...previous };
    delete process.env.EMAIL_PROVIDER;
    delete process.env.RAILWAY_ENVIRONMENT;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.env = { ...previous };
    jest.restoreAllMocks();
  });

  function readEnv() {
    let config!: typeof EnvModule;
    jest.isolateModules(() => {
      config = jest.requireActual('../../src/config/env');
    });
    return config.env;
  }

  it.each([undefined, 'smtp'])('mantiene SMTP con EMAIL_PROVIDER=%s', (provider) => {
    if (provider) process.env.EMAIL_PROVIDER = provider;
    const env = readEnv();
    expect(env.EMAIL_PROVIDER).toBe('smtp');
    expect(env.EMAIL_USER).toBe(previous.EMAIL_USER);
    expect(env.EMAIL_APP_PASSWORD).toBe(previous.EMAIL_APP_PASSWORD);
    expect(env.EMAIL_FROM).toBe(previous.EMAIL_USER);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each(['EMAIL_USER', 'EMAIL_APP_PASSWORD'])(
    'SMTP exige %s aunque haya contacto de privacidad',
    (name) => {
      process.env[name] = ' ';
      process.env.PRIVACY_CONTACT_EMAIL = 'privacidad@example.invalid';
      expect(readEnv).toThrow(`EMAIL_PROVIDER=smtp requiere ${name}`);
    },
  );

  it('console no exige variables de correo y avisa una sola vez', () => {
    process.env.EMAIL_PROVIDER = 'console';
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_APP_PASSWORD;
    delete process.env.PRIVACY_CONTACT_EMAIL;
    const env = readEnv();
    expect(env.EMAIL_FROM).toBe('pruebas@example.invalid');
    expect(env.PRIVACY_CONTACT_EMAIL).toBe('privacidad@example.invalid');
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      'Correo en modo consola: los mensajes NO se envían, se imprimen aquí',
    );
  });

  it('console conserva un contacto de privacidad explícito', () => {
    process.env.EMAIL_PROVIDER = 'console';
    delete process.env.EMAIL_USER;
    process.env.PRIVACY_CONTACT_EMAIL = 'contacto@example.invalid';
    expect(readEnv().PRIVACY_CONTACT_EMAIL).toBe('contacto@example.invalid');
  });

  it.each([
    { NODE_ENV: 'production' },
    { RAILWAY_ENVIRONMENT: 'production' },
    { RAILWAY_ENVIRONMENT: 'staging' },
    { RAILWAY_ENVIRONMENT: '' },
  ])('rechaza el arranque console con %j antes de exigir otras variables', (overrides) => {
    process.env.EMAIL_PROVIDER = 'console';
    Object.assign(process.env, overrides);
    delete process.env.SUPABASE_URL;
    expect(readEnv).toThrow('EMAIL_PROVIDER=console está prohibido');
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('SMTP sigue permitido en producción y Railway', () => {
    process.env.NODE_ENV = 'production';
    process.env.RAILWAY_ENVIRONMENT = 'production';
    process.env.CAPTCHA_PROVIDER = 'turnstile';
    expect(readEnv().EMAIL_PROVIDER).toBe('smtp');
  });

  it('rechaza proveedores desconocidos sin revelar valores', () => {
    process.env.EMAIL_PROVIDER = 'desconocido';
    expect(readEnv).toThrow('EMAIL_PROVIDER debe ser smtp o console');
  });
});

import type * as EnvModule from '../../src/config/env';

jest.mock('dotenv', () => ({ config: jest.fn() }));

// Modo demostración (DEMO_MODE=true): único camino para arrancar en production con captcha off y
// pago simulado. Sin DEMO_MODE la regla estricta de production no cambia.
describe('modo demostración en la validación de entorno', () => {
  const previous = { ...process.env };
  let warn: jest.SpyInstance;
  beforeEach(() => {
    process.env = { ...previous };
    delete process.env.RAILWAY_ENVIRONMENT;
    delete process.env.DEMO_MODE;
    delete process.env.CORS_ORIGINS;
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
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

  const demoAviso = 'MODO DEMOSTRACIÓN ACTIVO: captcha y pago simulados; no usar con datos reales';

  it('production sin demo con captcha off falla', () => {
    process.env.NODE_ENV = 'production';
    process.env.CAPTCHA_PROVIDER = 'off';
    process.env.PAYMENT_PROVIDER = 'manual';
    expect(readEnv).toThrow('CAPTCHA_PROVIDER=off está prohibido');
  });

  it('production sin demo con pago simulado falla', () => {
    process.env.NODE_ENV = 'production';
    process.env.CAPTCHA_PROVIDER = 'turnstile';
    process.env.TURNSTILE_SECRET_KEY = 'secreto-ficticio-solo-prueba';
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'clave-publica-ficticia';
    process.env.PAYMENT_PROVIDER = 'simulado';
    expect(readEnv).toThrow('PAYMENT_PROVIDER=simulado está prohibido');
  });

  it('DEMO_MODE=false explícito no relaja nada', () => {
    process.env.NODE_ENV = 'production';
    process.env.DEMO_MODE = 'false';
    process.env.CAPTCHA_PROVIDER = 'off';
    expect(readEnv).toThrow('CAPTCHA_PROVIDER=off está prohibido');
  });

  it('production con demo permite captcha off y pago simulado, e imprime el aviso', () => {
    process.env.NODE_ENV = 'production';
    process.env.DEMO_MODE = 'true';
    process.env.CAPTCHA_PROVIDER = 'off';
    process.env.PAYMENT_PROVIDER = 'simulado';
    const env = readEnv();
    expect(env.DEMO_MODE).toBe(true);
    expect(env.CAPTCHA_PROVIDER).toBe('off');
    expect(env.PAYMENT_PROVIDER).toBe('simulado');
    expect(warn).toHaveBeenCalledWith(demoAviso);
  });

  it('production con demo no relaja el correo por consola', () => {
    process.env.NODE_ENV = 'production';
    process.env.DEMO_MODE = 'true';
    process.env.CAPTCHA_PROVIDER = 'off';
    process.env.PAYMENT_PROVIDER = 'simulado';
    process.env.EMAIL_PROVIDER = 'console';
    expect(readEnv).toThrow('EMAIL_PROVIDER=console está prohibido');
  });

  it('desarrollo no cambia: sin demo, sin aviso y con valores locales permitidos', () => {
    process.env.NODE_ENV = 'development';
    process.env.CAPTCHA_PROVIDER = 'off';
    process.env.PAYMENT_PROVIDER = 'simulado';
    const env = readEnv();
    expect(env.DEMO_MODE).toBe(false);
    expect(warn).not.toHaveBeenCalledWith(demoAviso);
  });

  it('rechaza un valor de DEMO_MODE distinto de true o false', () => {
    process.env.DEMO_MODE = 'si';
    expect(readEnv).toThrow('DEMO_MODE debe ser true o false');
  });

  it('CORS_ORIGINS vacío por defecto y acepta una lista de orígenes exactos', () => {
    expect(readEnv().CORS_ORIGINS).toEqual([]);
    process.env.CORS_ORIGINS = 'https://app.vercel.app/, https://preview-1.vercel.app';
    expect(readEnv().CORS_ORIGINS).toEqual(['https://app.vercel.app', 'https://preview-1.vercel.app']);
  });

  it.each(['*', 'https://*.vercel.app', 'no-es-url', 'ftp://host.example'])(
    'CORS_ORIGINS rechaza %s',
    (value) => {
      process.env.CORS_ORIGINS = value;
      expect(readEnv).toThrow(/CORS_ORIGINS/);
    },
  );
});

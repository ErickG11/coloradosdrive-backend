import { CaptchaService } from '../../src/services/captcha.service';
import { validateCaptchaConfiguration } from '../../src/config/captcha';
import type { CaptchaConfig } from '../../src/config/captcha';
const config: CaptchaConfig & { FRONTEND_URL: string } = {
  NODE_ENV: 'production',
  CAPTCHA_PROVIDER: 'turnstile',
  TURNSTILE_SECRET_KEY: 'secreto-ficticio-solo-prueba',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'clave-publica-ficticia',
  FRONTEND_URL: 'https://escuela.example.invalid',
};
const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
beforeEach(() => {
  request.mockReset();
});
function reply(body: unknown, status = 200): void {
  request.mockResolvedValue(new Response(JSON.stringify(body), { status }));
}
test('off solo fuera de producción y nunca hace red', async () => {
  const off = {
    ...config,
    NODE_ENV: 'development',
    CAPTCHA_PROVIDER: 'off' as const,
    TURNSTILE_SECRET_KEY: '',
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: '',
  };
  await new CaptchaService(off, request).verify(undefined, '192.0.2.1');
  expect(request).not.toHaveBeenCalled();
  expect(() => new CaptchaService({ ...off, NODE_ENV: 'production' }, request)).toThrow(
    'off está prohibido',
  );
});
test.each(['TURNSTILE_SECRET_KEY', 'NEXT_PUBLIC_TURNSTILE_SITE_KEY'] as const)(
  'turnstile exige %s sin imprimir valores',
  (field) => {
    expect(() => {
      validateCaptchaConfiguration({ ...config, [field]: '' });
    }).toThrow(field);
  },
);
test('claves oficiales dummy se permiten en local y se prohíben en producción', () => {
  const dummy = {
    ...config,
    TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  };
  expect(() => {
    validateCaptchaConfiguration({ ...dummy, NODE_ENV: 'development' });
  }).not.toThrow();
  expect(() => {
    validateCaptchaConfiguration(dummy);
  }).toThrow('claves de prueba');
});
test.each([undefined, null, '', '  ', 123, 'x'.repeat(2049), 'token\r\n', 'token\u202e'])(
  'rechaza captcha ausente/inválido antes de red (%#)',
  async (token) => {
    await expect(
      new CaptchaService(config, request).verify(token, '192.0.2.1'),
    ).rejects.toMatchObject({ code: 'CAPTCHA_INVALIDO', statusCode: 400 });
    expect(request).not.toHaveBeenCalled();
  },
);
test('POST seguro incluye secret,response,remoteip y timeout sin seguir redirects', async () => {
  reply({ success: true, hostname: 'escuela.example.invalid' });
  await new CaptchaService(config, request).verify('token-ficticio', '192.0.2.1');
  expect(request).toHaveBeenCalledTimes(1);
  const [url, options] = request.mock.calls[0];
  expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
  expect(options).toMatchObject({
    method: 'POST',
    redirect: 'error',
    signal: expect.any(AbortSignal),
  });
  expect(Object.fromEntries((options?.body as URLSearchParams).entries())).toEqual({
    secret: config.TURNSTILE_SECRET_KEY,
    response: 'token-ficticio',
    remoteip: '192.0.2.1',
  });
});
test.each(['invalid-input-response', 'timeout-or-duplicate'])(
  'falla cerrado ante %s sin reflejar tokens',
  async (error) => {
    reply({ success: false, 'error-codes': [error] });
    await expect(
      new CaptchaService(config, request).verify('token-ficticio', undefined),
    ).rejects.toMatchObject({ code: 'CAPTCHA_INVALIDO' });
  },
);
test('proveedor caído da 503 y sugerencia WhatsApp sin emitir logs', async () => {
  request.mockRejectedValue(new Error('IP, token y secretos del proveedor'));
  const logs = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    await expect(
      new CaptchaService(config, request).verify('token-ficticio', undefined),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: 'VERIFICACION_NO_DISPONIBLE',
      message: expect.stringContaining('WhatsApp'),
    });
    expect(logs).not.toHaveBeenCalled();
  } finally {
    logs.mockRestore();
  }
});
test.each([null, [], {}, { success: 'true' }])(
  'respuesta ilegible falla cerrado (%#)',
  async (body) => {
    reply(body);
    await expect(
      new CaptchaService(config, request).verify('token-ficticio', undefined),
    ).rejects.toMatchObject({ code: 'VERIFICACION_NO_DISPONIBLE' });
  },
);
test.each([302, 429, 500])('HTTP %s no permite continuar', async (status) => {
  reply({ success: true }, status);
  await expect(
    new CaptchaService(config, request).verify('token-ficticio', undefined),
  ).rejects.toMatchObject({ code: 'VERIFICACION_NO_DISPONIBLE' });
});
test('hostname ajeno no habilita inscripción en producción', async () => {
  reply({ success: true, hostname: 'otra.example.invalid' });
  await expect(
    new CaptchaService(config, request).verify('token-ficticio', undefined),
  ).rejects.toMatchObject({ code: 'CAPTCHA_INVALIDO' });
});
test.each(['invalid-input-secret', 'missing-input-secret', 'internal-error'])(
  'fallo del servidor %s da 503',
  async (error) => {
    reply({ success: false, 'error-codes': [error] });
    await expect(
      new CaptchaService(config, request).verify('token-ficticio', undefined),
    ).rejects.toMatchObject({ code: 'VERIFICACION_NO_DISPONIBLE', statusCode: 503 });
  },
);
test('JSON inválido y timeout se convierten en error recuperable', async () => {
  request.mockResolvedValueOnce(new Response('{', { status: 200 }));
  await expect(
    new CaptchaService(config, request).verify('token-ficticio', undefined),
  ).rejects.toMatchObject({ code: 'VERIFICACION_NO_DISPONIBLE' });
  request.mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
  await expect(
    new CaptchaService(config, request).verify('token-ficticio', undefined),
  ).rejects.toMatchObject({ code: 'VERIFICACION_NO_DISPONIBLE' });
});

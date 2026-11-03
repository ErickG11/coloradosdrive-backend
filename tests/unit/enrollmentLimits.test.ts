import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import { env } from '../../src/config/env';
import { enrollmentRateKey } from '../../src/utils/enrollmentRateKey';
import { EnrollmentLimitsService } from '../../src/services/enrollmentLimits.service';
import { createChain } from '../helpers/supabaseMock';
const secret = 'secreto-ficticio-para-limites-de-32-caracteres';
const hash = (kind: 'ip' | 'correo', value: string) => enrollmentRateKey(kind, value, secret);
test('IPv6 agrupa /64; compresión y IPv4 mapeada no cambian identidad', () => {
  expect(hash('ip', '2001:db8:1:2::1')).toBe(hash('ip', '2001:0db8:0001:0002:ffff::a'));
  expect(hash('ip', '2001:db8:1:2::1')).not.toBe(hash('ip', '2001:db8:1:3::1'));
  expect(hash('ip', '::ffff:192.0.2.1')).toBe(hash('ip', '192.0.2.1'));
  expect(hash('ip', '192.0.2.1')).not.toBe(hash('ip', '192.0.2.2'));
});
test('HMAC de correo usa unicidad Gmail y dominios separados de clave de token', () => {
  expect(hash('correo', 'a.b+tag@googlemail.com')).toBe(hash('correo', 'ab@gmail.com'));
  expect(hash('correo', 'ab@example.invalid')).toMatch(/^[a-f0-9]{64}$/);
  expect(hash('ip', '192.0.2.1')).not.toContain('192.0.2.1');
  expect(enrollmentRateKey('ip', '192.0.2.1', secret + 'otro')).not.toBe(hash('ip', '192.0.2.1'));
});
function setup(data: unknown = { permitido: true }, error: unknown = null) {
  const rpc = jest.fn().mockResolvedValue({ data, error }),
    from = jest.fn();
  return {
    rpc,
    from,
    service: new EnrollmentLimitsService({ rpc, from } as unknown as SupabaseClient<Database>),
  };
}
test('RPC solo recibe HMAC y topes de servidor, no correo/IP en claro', async () => {
  const h = setup();
  await h.service.reserveCodeIp('2001:db8:1::42');
  await h.service.reserveCode('a.b+tag@gmail.com');
  const payload = JSON.stringify(h.rpc.mock.calls);
  expect(payload).not.toContain('2001:db8');
  expect(payload).not.toContain('gmail.com');
  expect(h.rpc.mock.calls[0][1]).toMatchObject({
    p_operacion: 'codigo_ip',
    p_ip_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(h.rpc.mock.calls[1][1].p_topes).toMatchObject({
    codigos: 250,
    solicitudes: 150,
    subidas: 40,
    codigosCorreoDia: 5,
    fallosCorreoDia: 10,
  });
});
test.each([
  ['cerradas', 503, 'INSCRIPCIONES_CERRADAS'],
  ['limite', 429, 'CUPO_DIARIO_AGOTADO'],
])('denegación %s tiene contrato estable', async (motivo, statusCode, code) => {
  const h = setup({ permitido: false, motivo });
  await expect(h.service.reserveCode('ana@example.invalid')).rejects.toMatchObject({
    statusCode,
    code,
  });
});
test('fallo de BD falla cerrado sin reflejar excepciones con datos personales', async () => {
  const h = setup(null, { message: 'datos secretos' });
  await expect(h.service.reserveCodeIp('192.0.2.1')).rejects.toMatchObject({
    statusCode: 503,
    code: 'VERIFICACION_NO_DISPONIBLE',
  });
});
test('fallos y subidas tienen operaciones dedicadas; subida lleva id ligado por auth', async () => {
  const h = setup();
  await h.service.recordFailedCode('ana@example.invalid');
  await h.service.reserveUpload('192.0.2.1', 'id-ficticio');
  expect(h.rpc.mock.calls[0][1].p_operacion).toBe('fallo_codigo');
  expect(h.rpc.mock.calls[1][1]).toMatchObject({
    p_operacion: 'subida',
    p_solicitud: 'id-ficticio',
  });
});
test('nuevo expediente usa creación con presupuesto en una sola RPC', async () => {
  const h = setup({ id: 'id-ficticio', creada: true, permitido: true });
  await expect(
    h.service.createDraft(' ANA@EXAMPLE.INVALID ', 'curso-ficticio', 'a'.repeat(64), '2026-11-03'),
  ).resolves.toEqual({ id: 'id-ficticio', creada: true });
  expect(h.rpc).toHaveBeenCalledWith(
    'crear_borrador_limitado',
    expect.objectContaining({ p_correo: 'ana@example.invalid', p_curso: 'curso-ficticio' }),
  );
  expect(h.from).not.toHaveBeenCalled();
});
test('configuración pública lista columnas explícitas y nunca exporta secretos', async () => {
  const h = setup(),
    settings = createChain({ data: { inscripciones_abiertas: true }, error: null }),
    courses = createChain({
      data: [{ id: 'curso', tipo: 'A', nombre: 'Curso', edad_minima: 17, secret: 'oculto' }],
      error: null,
    });
  h.from.mockReturnValueOnce(settings).mockReturnValueOnce(courses);
  const value = await h.service.publicConfig();
  expect(value.cursos).toEqual([{ id: 'curso', tipo: 'A', nombre: 'Curso', edadMinima: 17 }]);
  expect(JSON.stringify(value)).not.toContain('oculto');
  expect(value).not.toHaveProperty('TURNSTILE_SECRET_KEY');
  expect(courses.select).toHaveBeenCalledWith('id,tipo,nombre,edad_minima');
});
test('actualización solo admite booleano y actor del servidor', async () => {
  const h = setup({ inscripcionesAbiertas: false });
  await h.service.updateSettings('admin', { inscripcionesAbiertas: false });
  expect(h.rpc).toHaveBeenCalledWith('actualizar_config_inscripcion', {
    p_actor: 'admin',
    p_abiertas: false,
  });
  await expect(
    h.service.updateSettings('admin', { inscripcionesAbiertas: 'false' }),
  ).rejects.toMatchObject({ code: 'CAMPO_INVALIDO' });
  await expect(
    h.service.updateSettings('admin', { inscripcionesAbiertas: false, actor: 'otro' }),
  ).rejects.toMatchObject({ code: 'CAMPO_NO_PERMITIDO' });
});
test('alertas en 80% exacto para todos los topes, incluido tope cero', async () => {
  const h = setup({
    pendientes: 2,
    devueltas: 1,
    conMasDe48h: 1,
    inscripcionesAbiertas: true,
    contadoresHoy: { codigos: 199, subidas: 32, solicitudes: 120 },
  });
  const value = await h.service.summary();
  expect(value.alertas).toEqual(['subidas', 'solicitudes']);
  expect(value.cupoCodigosHoy.alerta).toBe(false);
  const zero = new EnrollmentLimitsService({ rpc: h.rpc } as unknown as SupabaseClient<Database>, {
    ...env,
    ENROLLMENT_CODES_DAILY_CAP: 0,
  });
  expect((await zero.summary()).cupoCodigosHoy.alerta).toBe(true);
});
test('tope de subidas agotado explica que se puede continuar sin archivo', async () => {
  const h = setup({ permitido: false, motivo: 'limite' });
  await expect(h.service.reserveUpload('192.0.2.1', 'id-ficticio')).rejects.toMatchObject({
    statusCode: 429,
    code: 'CUPO_DIARIO_AGOTADO',
    message: expect.stringContaining('sin archivo') as string,
  });
});
test('el cierre de inscripciones no se disfraza de tope de archivos', async () => {
  const h = setup({ permitido: false, motivo: 'cerradas' });
  await expect(h.service.reserveUpload('192.0.2.1', 'id-ficticio')).rejects.toMatchObject({
    code: 'INSCRIPCIONES_CERRADAS',
  });
});

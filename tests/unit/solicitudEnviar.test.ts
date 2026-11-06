import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import { EmailService } from '../../src/services/email.service';
import { SolicitudService } from '../../src/services/solicitud.service';
import { createChain } from '../helpers/supabaseMock';

const id = '11111111-1111-4111-8111-111111111111';
const enviadaAt = '2026-11-03T12:00:00Z';

function harness(rpcResult: { data: unknown; error: unknown }, mailFails = false) {
  const rpc = jest.fn().mockResolvedValue(rpcResult);
  const from = jest
    .fn()
    .mockReturnValue(createChain({ data: { correo: 'ana@example.com' }, error: null }));
  const sendMail = jest
    .fn()
    .mockImplementation(() =>
      mailFails ? Promise.reject(new Error('smtp caído')) : Promise.resolve({}),
    );
  const service = new SolicitudService(
    { rpc, from } as unknown as SupabaseClient<Database>,
    new EmailService({ sendMail }),
    {} as never,
    {} as never,
  );
  return { rpc, from, sendMail, service };
}
const ok = (transicion: boolean) => ({
  data: { id, estado: 'enviada', enviadaAt, transicion },
  error: null,
});

it('envía por la RPC con las versiones vigentes y manda el acuse una sola vez', async () => {
  const h = harness(ok(true));
  await expect(h.service.enviar(id)).resolves.toEqual({ id, estado: 'enviada', enviadaAt });
  expect(h.rpc).toHaveBeenCalledWith(
    'enviar_solicitud_inscripcion',
    expect.objectContaining({ p_id: id, p_modo: 'enviar' }),
  );
  expect(h.sendMail).toHaveBeenCalledTimes(1);
});
it('un envío repetido devuelve la misma fecha y no repite el correo', async () => {
  const h = harness(ok(false));
  await expect(h.service.enviar(id)).resolves.toEqual({ id, estado: 'enviada', enviadaAt });
  expect(h.sendMail).not.toHaveBeenCalled();
  expect(h.from).not.toHaveBeenCalled();
});
it('reenviar usa el modo reenviar y el acuse lo distingue', async () => {
  const h = harness(ok(true));
  await h.service.reenviar(id);
  expect(h.rpc.mock.calls[0][1]).toMatchObject({ p_modo: 'reenviar' });
  const mail = h.sendMail.mock.calls[0][0] as { text: string };
  expect(mail.text).toContain('corrección');
});
it('el acuse no contiene datos personales ni archivos y apunta al origen configurado', async () => {
  const h = harness(ok(true));
  await h.service.enviar(id);
  const mail = h.sendMail.mock.calls[0][0] as {
    to: string;
    subject: string;
    text: string;
    html: string;
  };
  expect(mail.to).toBe('ana@example.com');
  expect(mail.subject).not.toMatch(/[\r\n]/);
  expect(`${mail.text}${mail.html}`).not.toMatch(/ana|cédula|1710034065|certificado/i);
  expect(mail.text).toMatch(/https?:\/\/[^\s/]+\/inscripcion/);
});
it('un fallo del correo no deshace el envío ni se registra con datos', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const h = harness(ok(true), true);
  await expect(h.service.enviar(id)).resolves.toMatchObject({ estado: 'enviada' });
  expect(log).toHaveBeenCalledWith(JSON.stringify({ event: 'received_email_failed' }));
  log.mockRestore();
});
it.each([
  ['SI424', 400, 'SOLICITUD_INCOMPLETA'],
  ['SI435', 409, 'ESTADO_INCORRECTO'],
  ['SI409', 409, 'SOLICITUD_CERRADA'],
  ['SI403', 409, 'CONSENTIMIENTO_REQUERIDO'],
  ['SI422', 400, 'DATOS_REQUERIDOS'],
  ['SI423', 400, 'REPRESENTANTE_REQUERIDO'],
  ['SI425', 400, 'EDAD_MINIMA'],
  ['SI429', 409, 'DATOS_NO_REGISTRADOS'],
  ['SI401', 403, 'CORREO_NO_VERIFICADO'],
])('traduce %s a %i %s sin enviar correo', async (sql, status, code) => {
  const h = harness({
    data: null,
    error: {
      code: sql,
      message: 'x',
      details: JSON.stringify({ faltantes: ['certificado_estudios', 'otro'] }),
    },
  });
  await expect(h.service.enviar(id)).rejects.toMatchObject({ statusCode: status, code });
  expect(h.sendMail).not.toHaveBeenCalled();
});
it('la falta del certificado informa solo el faltante conocido', async () => {
  const h = harness({
    data: null,
    error: {
      code: 'SI424',
      message: 'x',
      details: JSON.stringify({ faltantes: ['certificado_estudios', 'otro'] }),
    },
  });
  await expect(h.service.enviar(id)).rejects.toMatchObject({
    detalles: { faltantes: ['certificado_estudios'] },
  });
});
it('sin respuesta de la RPC falla cerrado', async () => {
  const h = harness({ data: null, error: null });
  await expect(h.service.enviar(id)).rejects.toMatchObject({ statusCode: 503 });
});

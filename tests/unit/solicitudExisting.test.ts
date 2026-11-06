import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import type { AccountService } from '../../src/services/account.service';
import type { CohortAssignmentService } from '../../src/services/cohortAssignment.service';
import type { EmailService } from '../../src/services/email.service';
import { SolicitudService } from '../../src/services/solicitud.service';
import { SolicitudPrivacyService } from '../../src/services/solicitudPrivacy.service';
import { createSupabaseFromMock } from '../helpers/supabaseMock';
import { verifySolicitudClaims } from '../../src/utils/solicitudToken';
function service(rpc: jest.Mock, email: object = {}) {
  return new SolicitudService(
    { rpc } as unknown as SupabaseClient<Database>,
    email as EmailService,
    {} as AccountService,
    {} as CohortAssignmentService,
  );
}
it.each(['borrador', 'enviada', 'devuelta', 'aprobada', 'rechazada'])(
  'emisión de %s conserva el expediente por RPC, sin asignar estado desde cliente',
  async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { emitir: true, correo: 'original@example.invalid' },
      error: null,
    });
    const email = { sendVerificationCodeEmail: jest.fn().mockResolvedValue(undefined) };
    await service(rpc, email).verificarCorreo(' ANA@example.com ', 'otro');
    const args = rpc.mock.calls[0][1];
    expect(args).not.toHaveProperty('estado');
    expect(args).not.toHaveProperty('cedula');
    expect(args.p_correo).toBe('ana@example.com');
    expect(email.sendVerificationCodeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'original@example.invalid',
        code: expect.stringMatching(/^\d{6}$/),
      }),
    );
  },
);
it('cuenta sin solicitud tiene éxito sin código ni creación desde Node', async () => {
  const rpc = jest.fn().mockResolvedValue({ data: { emitir: false }, error: null }),
    email = { sendVerificationCodeEmail: jest.fn() };
  await expect(
    service(rpc, email).verificarCorreo('ana@example.com', 'c'),
  ).resolves.toBeUndefined();
  expect(email.sendVerificationCodeEmail).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledTimes(1);
});
it.each(['borrador', 'enviada', 'devuelta', 'aprobada', 'rechazada'])(
  'progreso expone estado explícito %s sin notas internas',
  async (estado) => {
    const from = createSupabaseFromMock([
      {
        data: {
          id: 's',
          course_id: 'c',
          estado,
          enviada_at: estado === 'borrador' ? null : '2026-10-01',
          motivo_rechazo: 'Mensaje público',
          correo_verificado: true,
          devuelta_at: null,
          devolucion_mensaje: 'Corrige el documento.',
          devolucion_nota_interna: 'Secreto interno',
        },
        error: null,
      },
      { data: null, error: null },
      { data: [], error: null },
      { data: null, error: null },
    ]);
    const result = await new SolicitudPrivacyService({
      from,
    } as unknown as SupabaseClient<Database>).progress('s');
    expect(result.estado).toBe(estado);
    expect('motivoRechazo' in result).toBe(estado === 'rechazada');
    expect(JSON.stringify(result)).not.toContain('Secreto interno');
  },
);
it('confirmación aprobada entrega scope estado sin añadir estado al body', async () => {
  const rpc = jest
    .fn()
    .mockResolvedValue({ data: { resultado: 'valido', id: 's', scope: 'estado' }, error: null });
  const result = await service(rpc).confirmarCodigo('ana@example.com', '012345');
  expect(verifySolicitudClaims(result.token)?.scope).toBe('estado');
  expect(result).not.toHaveProperty('estado');
});

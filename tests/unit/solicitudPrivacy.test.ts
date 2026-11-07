import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import {
  privacyNotice,
  SolicitudPrivacyService,
} from '../../src/services/solicitudPrivacy.service';
import { PRIVACY_NOTICE_VERSION, TERMS_VERSION } from '../../src/config/privacy';
import { createSupabaseFromMock } from '../helpers/supabaseMock';
it('publica versión y valores por defecto sin claves privadas', () => {
  const notice = privacyNotice();
  expect(notice).toMatchObject({
    version: PRIVACY_NOTICE_VERSION,
    versionAviso: PRIVACY_NOTICE_VERSION,
    versionTerminos: TERMS_VERSION,
    contactoDerechos: 'test-sender@test.local',
    retencionDias: 30,
    enRevisionLegal: true,
  });
  // El aviso nombra expresamente el dato de salud (tipo de sangre).
  expect(JSON.stringify(notice.aviso)).toContain('dato de salud');
  expect(JSON.stringify(notice)).not.toMatch(/SECRET|KEY/i);
});
// Orden de consultas de progress(): solicitud, consentimiento, documentos, curso y las dos
// últimas verificaciones (identidad y estudios).
it('reanuda datos propios verificados sin enlaces de documentos', async () => {
  const from = createSupabaseFromMock([
    {
      data: {
        course_id: 'c',
        estado: 'borrador',
        correo_verificado: true,
        nombres: 'Ana',
        apellidos: 'Torres',
        nacionalidad_tipo: 'ecuatoriana',
        tipo_sangre: 'O+',
        cedula: '1710034065',
        solicitada_at: '2026-10-01',
        fecha_nacimiento: '2000-01-01',
        telefono: '0991234567',
      },
      error: null,
    },
    { data: null, error: null },
    { data: [{ tipo_documento: 'certificado_estudios', estado: 'recibido' }], error: null },
    { data: null, error: null },
    { data: null, error: null },
    { data: null, error: null },
  ]);
  const result = await new SolicitudPrivacyService({
    from,
  } as unknown as SupabaseClient<Database>).progress('s');
  expect(result).toMatchObject({
    datosGuardados: true,
    consentimientoVigente: false,
    documentos: [{ tipo: 'certificado_estudios', estado: 'recibido' }],
  });
  expect(result).not.toHaveProperty('cedula');
});

it('rechaza versión antigua y casillas falsas antes de escribir', async () => {
  const from = jest.fn();
  const service = new SolicitudPrivacyService({ from } as unknown as SupabaseClient<Database>);
  await expect(
    service.accept('s', { versionAviso: 'viejo', aceptoTratamiento: true, declaraVeracidad: true }),
  ).rejects.toMatchObject({ code: 'AVISO_DESACTUALIZADO' });
  await expect(
    service.accept('s', {
      versionAviso: PRIVACY_NOTICE_VERSION,
      versionTerminos: TERMS_VERSION,
      aceptoTratamiento: false,
      declaraVeracidad: true,
      aceptoTerminos: true,
    }),
  ).rejects.toMatchObject({ code: 'CONSENTIMIENTO_REQUERIDO' });
  expect(from).not.toHaveBeenCalled();
});
it('devuelve el motivo del documento rechazado para poder corregirlo sin exponer rutas', async () => {
  const from = createSupabaseFromMock([
    { data: { course_id: 'c', estado: 'borrador' }, error: null },
    { data: null, error: null },
    {
      data: [
        {
          tipo_documento: 'certificado_estudios',
          estado: 'rechazado',
          motivo_rechazo: 'Foto borrosa',
          storage_path: 'privado',
        },
      ],
      error: null,
    },
    { data: null, error: null },
    { data: null, error: null },
    { data: null, error: null },
  ]);
  const result = await new SolicitudPrivacyService({
    from,
  } as unknown as SupabaseClient<Database>).progress('s');
  expect(result.documentos).toEqual([
    { tipo: 'certificado_estudios', estado: 'rechazado', motivoRechazo: 'Foto borrosa' },
  ]);
});
it('exige un registro vigente persistido', async () => {
  const from = createSupabaseFromMock([{ data: null, error: null }]);
  await expect(
    new SolicitudPrivacyService({ from } as unknown as SupabaseClient<Database>).requireConsent(
      's',
    ),
  ).rejects.toMatchObject({ code: 'CONSENTIMIENTO_REQUERIDO' });
});

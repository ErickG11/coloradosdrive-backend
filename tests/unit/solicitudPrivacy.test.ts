import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import { privacyNotice, SolicitudPrivacyService } from '../../src/services/solicitudPrivacy.service';
import { createSupabaseFromMock } from '../helpers/supabaseMock';
it('publica versión y valores por defecto sin claves privadas', () => {
  expect(privacyNotice()).toEqual({ version: '2026-10-v1', contactoDerechos: 'test-sender@test.local', retencionDias: 30 });
});
it('reanuda datos sin devolver identidad ni enlaces de documentos', async () => {
  const from = createSupabaseFromMock([
    { data: { course_id: 'c', estado: 'pendiente_revision', correo_verificado: true, cedula: '1710034065', solicitada_at: '2026-10-01', fecha_nacimiento: '2000-01-01' }, error: null },
    { data: null, error: null },
    { data: [{ tipo_documento: 'cedula', estado: 'recibido' }], error: null },
  ]);
  const result = await new SolicitudPrivacyService({ from } as unknown as SupabaseClient<Database>).progress('s');
  expect(result).toMatchObject({ datosGuardados: true, consentimientoVigente: false, documentos: [{ tipo: 'cedula', estado: 'recibido' }] });
  expect(result).not.toHaveProperty('cedula');
});

it('rechaza versión antigua y casillas falsas antes de escribir', async () => {
  const from = jest.fn();
  const service = new SolicitudPrivacyService({ from } as unknown as SupabaseClient<Database>);
  await expect(service.accept('s', { versionAviso: 'viejo', aceptoTratamiento: true, declaraVeracidad: true })).rejects.toMatchObject({ code: 'AVISO_DESACTUALIZADO' });
  await expect(service.accept('s', { versionAviso: '2026-10-v1', aceptoTratamiento: false, declaraVeracidad: true })).rejects.toMatchObject({ code: 'CONSENTIMIENTO_REQUERIDO' });
  expect(from).not.toHaveBeenCalled();
});
it('devuelve el motivo del documento rechazado para poder corregirlo sin exponer rutas', async () => {
  const from = createSupabaseFromMock([
    { data: { course_id: 'c', estado: 'pendiente_revision' }, error: null },
    { data: null, error: null },
    { data: [{ tipo_documento: 'cedula', estado: 'rechazado', motivo_rechazo: 'Foto borrosa', storage_path: 'privado' }], error: null },
  ]);
  const result = await new SolicitudPrivacyService({ from } as unknown as SupabaseClient<Database>).progress('s');
  expect(result.documentos).toEqual([{ tipo: 'cedula', estado: 'rechazado', motivoRechazo: 'Foto borrosa' }]);
});
it('exige un registro vigente persistido', async () => {
  const from = createSupabaseFromMock([{ data: null, error: null }]);
  await expect(new SolicitudPrivacyService({ from } as unknown as SupabaseClient<Database>).requireConsent('s')).rejects.toMatchObject({ code: 'CONSENTIMIENTO_REQUERIDO' });
});

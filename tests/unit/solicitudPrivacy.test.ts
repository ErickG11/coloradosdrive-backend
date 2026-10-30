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

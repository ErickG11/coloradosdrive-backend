import type * as Service from '../../src/services/individualEnrollmentAccess.service';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import { createChain } from '../helpers/supabaseMock';

jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: {}, supabaseAnon: {} }));

const { individualEnrollmentAccess } = jest.requireActual<typeof Service>(
  '../../src/services/individualEnrollmentAccess.service',
);

function db(flag: { enabled: boolean; implemented: boolean }, rpcResult?: unknown) {
  const from = jest.fn().mockReturnValue(createChain({ data: flag, error: null }));
  const rpc = jest.fn().mockResolvedValue({ data: rpcResult, error: null });
  return { client: { from, rpc } as unknown as SupabaseClient<Database>, from, rpc };
}

describe('individualEnrollmentAccess', () => {
  it('responde inactivo sin llamar a la función SQL si el indicador está apagado', async () => {
    const { client, from, rpc } = db({ enabled: false, implemented: true });
    const result = await individualEnrollmentAccess(client, 'alumno-1');
    expect(from).toHaveBeenCalledWith('enrollment_rule_flags');
    expect(result).toMatchObject({ active: false, enrollments: [] });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('responde inactivo si el indicador está encendido pero aún no implementado', async () => {
    const { client, rpc } = db({ enabled: true, implemented: false });
    expect(await individualEnrollmentAccess(client, 'alumno-1')).toMatchObject({ active: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('consulta student_enrollment_access_v2 cuando el indicador está activo', async () => {
    const access = { active: true, serverNow: '2026-11-13T00:00:00.000Z', enrollments: [] };
    const { client, rpc } = db({ enabled: true, implemented: true }, access);
    expect(await individualEnrollmentAccess(client, 'alumno-1')).toEqual(access);
    expect(rpc).toHaveBeenCalledWith('student_enrollment_access_v2', { p_student: 'alumno-1' });
  });
});

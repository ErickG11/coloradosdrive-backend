import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import { PracticeSlotActionService } from '../../src/services/practiceSlotAction.service';
import type { RealtimeService } from '../../src/services/realtime.service';
import { createChain } from '../helpers/supabaseMock';

describe('Asistencia: escritura exclusivamente transaccional', () => {
  const rpc = jest.fn();
  const from = jest.fn();
  const broadcast = jest.fn();
  const service = new PracticeSlotActionService(
    { rpc, from } as unknown as SupabaseClient<Database>,
    { broadcast } as unknown as RealtimeService,
  );
  beforeEach(() => jest.clearAllMocks());
  it.each([true, false])(
    'registra %s sin consulta ni escritura REST separadas',
    async (attended) => {
      rpc.mockReturnValue(createChain({ data: { id: 'slot', attended }, error: null }));
      await expect(service.markAttendance('slot', 'instructor', attended)).resolves.toMatchObject({
        id: 'slot',
        attended,
      });
      expect(rpc).toHaveBeenCalledWith('register_practice_attendance', {
        p_slot: 'slot',
        p_actor: 'instructor',
        p_attended: attended,
      });
      expect(from).not.toHaveBeenCalled();
      expect(broadcast).not.toHaveBeenCalled();
    },
  );
  it('no reintenta ni escribe fuera de la transaccion si falla el aviso', async () => {
    rpc.mockReturnValue(
      createChain({ data: null, error: { code: 'ZZ001', message: 'Fallo de bandeja' } }),
    );
    await expect(
      service.markAttendance('slot', 'actor', false, 'Motivo de la correccion'),
    ).rejects.toMatchObject({ code: 'ZZ001' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });
});

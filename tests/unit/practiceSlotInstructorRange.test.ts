import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../src/config/database.types';
import { PracticeSlotService } from '../../src/services/practiceSlot.service';
import { createChain } from '../helpers/supabaseMock';

const instructorId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const from = '2026-03-09T05:00:00.000Z';
const to = '2026-03-16T05:00:00.000Z';

function row(id: string, teacher: string, scheduledAt: string) {
  return {
    id, cohort_id: '33333333-3333-4333-8333-333333333333', instructor_id: teacher,
    student_id: null, scheduled_at: scheduledAt, duration_minutes: 60, status: 'disponible',
    confirmation_notified_at: null, release_notified_at: null, confirmed_at: null,
    attended: null, created_at: '', updated_at: '',
    instructor: { nombre_completo: 'Instructor', activo: true }, student: null,
  };
}

const rows = [
  row('before', instructorId, '2026-03-09T04:59:59.999Z'),
  row('at-from', instructorId, from),
  row('inside', instructorId, '2026-03-16T04:59:59.999Z'),
  row('at-to', instructorId, to),
  row('other', otherId, '2026-03-10T15:00:00.000Z'),
];

function harness() {
  const chain = createChain({ data: [], error: null });
  let selectedInstructor: string | undefined;
  let lower: string | undefined;
  let upper: string | undefined;
  chain.eq.mockImplementation((field: string, value: string) => {
    if (field === 'instructor_id') selectedInstructor = value;
    return chain;
  });
  chain.gte.mockImplementation((_field: string, value: string) => { lower = value; return chain; });
  chain.lt.mockImplementation((_field: string, value: string) => { upper = value; return chain; });
  chain.then = (resolve, reject) => Promise.resolve({
    data: rows.filter((item) => item.instructor_id === selectedInstructor &&
      (lower === undefined || item.scheduled_at >= lower) &&
      (upper === undefined || item.scheduled_at < upper)),
    error: null,
  }).then(resolve, reject);
  const fromMock = jest.fn().mockReturnValue(chain);
  const service = new PracticeSlotService({ from: fromMock } as unknown as SupabaseClient<Database>);
  return { chain, fromMock, service };
}

describe('PracticeSlotService.listSlotsForInstructor', () => {
  it('sin rango conserva el listado completo del instructor y el orden ascendente', async () => {
    const { chain, service } = harness();
    const result = await service.listSlotsForInstructor(instructorId);
    expect(result.map((slot) => slot.id)).toEqual(['before', 'at-from', 'inside', 'at-to']);
    expect(chain.gte).not.toHaveBeenCalled();
    expect(chain.lt).not.toHaveBeenCalled();
    expect(chain.order).toHaveBeenCalledWith('scheduled_at', { ascending: true });
  });

  it('incluye from, excluye to y omite las franjas del otro instructor', async () => {
    const { chain, service } = harness();
    const result = await service.listSlotsForInstructor(instructorId, { from, to });
    expect(result.map((slot) => slot.id)).toEqual(['at-from', 'inside']);
    expect(chain.eq).toHaveBeenCalledWith('instructor_id', instructorId);
    expect(chain.gte).toHaveBeenCalledWith('scheduled_at', from);
    expect(chain.lt).toHaveBeenCalledWith('scheduled_at', to);
  });
});

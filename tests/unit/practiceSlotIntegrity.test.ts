import { PracticeSlotService } from '../../src/services/practiceSlot.service';
import { PostgrestError } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import type { CreatePracticeSlotInput, UpdatePracticeSlotInput } from '../../src/models/practiceSlot.model';
import { effectivePracticeDuration, throwPracticeWriteError } from '../../src/utils/practiceSlotIntegrity';

describe('integridad de escrituras de práctica', () => {
  it.each([undefined, 60])('duración %s resulta en 60', (value) => {
    expect(effectivePracticeDuration(value)).toBe(60);
  });
  it.each([45, 90, 0, -1, Number.NaN])('rechaza duración %s', (value) => {
    expect(() => effectivePracticeDuration(value)).toThrow('exactamente 60');
  });
  it('el service valida también escrituras que no pasan por HTTP', async () => {
    const from = jest.fn();
    const service = new PracticeSlotService({ from } as unknown as SupabaseClient<Database>);
    await expect(service.createSlot({ durationMinutes: 45 } as unknown as CreatePracticeSlotInput))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(service.updateSlot('slot', { durationMinutes: 90 } as unknown as UpdatePracticeSlotInput))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(from).not.toHaveBeenCalled();
  });
  it('no convierte una violación única ajena en un conflicto de horario', () => {
    expect.assertions(1);
    const error = new PostgrestError({ code: '23505', message: 'practice_slots_pkey', details: '', hint: '' });
    try { throwPracticeWriteError(error); } catch (actual) { expect(actual).toBe(error); }
  });
  it('traduce el índice anterior durante una transición operativa', () => {
    expect(() => throwPracticeWriteError(new PostgrestError({ code: '23505', message: 'practice_slots_instructor_no_overlap', details: '', hint: '' })))
      .toThrow('se solapa');
  });
  it('traduce la restricción de duración sin divulgar detalles SQL', () => {
    expect(() => throwPracticeWriteError(new PostgrestError({ code: '23514', message: 'practice_slots_duration_60', details: '', hint: '' })))
      .toThrow('exactamente 60');
  });
});

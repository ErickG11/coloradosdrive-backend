import { PracticeSlotService } from '../../src/services/practiceSlot.service';
import { PostgrestError } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import type { CreatePracticeSlotInput, UpdatePracticeSlotInput } from '../../src/models/practiceSlot.model';
import { effectivePracticeDuration, throwPracticeWriteError } from '../../src/utils/practiceSlotIntegrity';
import { normalizePracticeScheduledAt } from '../../src/utils/practiceSlotTimestamp';
import { createChain } from '../helpers/supabaseMock';

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

describe('contrato temporal del CRUD de prácticas', () => {
  it.each([
    '2026-03-01',
    '2026-03-01T08:00:00',
    '2026-02-30T08:00:00Z',
    '2025-02-29T08:00:00Z',
    '2026-03-01T24:00:00Z',
    '2026-03-01T08:00:00+24:00',
    '2026-03-01T08:00:00-05:60',
    null,
  ])('rechaza %p en create y update internos antes de consultar datos', async (scheduledAt) => {
    const from = jest.fn();
    const service = new PracticeSlotService({ from } as unknown as SupabaseClient<Database>);
    await expect(service.createSlot({ cohortId: 'cohort', instructorId: 'instructor', scheduledAt } as CreatePracticeSlotInput))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('Z u offset explícito') });
    await expect(service.updateSlot('slot', { instructorId: 'instructor', scheduledAt } as UpdatePracticeSlotInput))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(from).not.toHaveBeenCalled();
  });

  it.each([
    ['2026-03-01T13:00:00Z', '2026-03-01T13:00:00.000Z'],
    ['2026-03-01T08:00:00-05:00', '2026-03-01T13:00:00.000Z'],
    ['2026-03-01T18:30+05:30', '2026-03-01T13:00:00.000Z'],
    ['2024-02-29T23:30:00.123456-05:00', '2024-03-01T04:30:00.123456Z'],
  ])('create y update escriben el instante UTC de %s', async (scheduledAt, expected) => {
    const write = createChain({ data: { scheduled_at: expected }, error: null });
    const from = jest.fn()
      .mockReturnValueOnce(createChain({ data: { id: 'cohort' }, error: null }))
      .mockReturnValueOnce(createChain({ data: { id: 'instructor', rol: 'instructor' }, error: null }))
      .mockReturnValue(write);
    const service = new PracticeSlotService({ from } as unknown as SupabaseClient<Database>);

    await service.createSlot({ cohortId: 'cohort', instructorId: 'instructor', scheduledAt });
    await service.updateSlot('slot', { scheduledAt });

    expect(write.insert).toHaveBeenCalledWith(expect.objectContaining({ scheduled_at: expected }));
    expect(write.update).toHaveBeenCalledWith({ scheduled_at: expected });
    expect(write.eq).toHaveBeenCalledWith('status', 'disponible');
  });

  it('08:00−05:00 y 13:00Z normalizan al mismo instante', () => {
    expect(normalizePracticeScheduledAt('2026-03-01T08:00:00-05:00'))
      .toBe(normalizePracticeScheduledAt('2026-03-01T13:00:00Z'));
  });

  it('omitir scheduledAt no lo incluye en el UPDATE interno', async () => {
    const current = '2026-03-01T13:00:00+00:00';
    const write = createChain({ data: { scheduled_at: current }, error: null });
    const service = new PracticeSlotService({ from: jest.fn().mockReturnValue(write) } as unknown as SupabaseClient<Database>);

    const result = await service.updateSlot('slot', { durationMinutes: 60 });

    expect(write.update).toHaveBeenCalledWith({ duration_minutes: 60 });
    expect(result.scheduledAt).toBe(current);
  });
});

import type { PostgrestError } from '@supabase/supabase-js';

import { AppError } from './AppError';

export const PRACTICE_DURATION_MINUTES = 60;

export function effectivePracticeDuration(duration: number | undefined): 60 {
  if (duration !== undefined && duration !== PRACTICE_DURATION_MINUTES) {
    throw new AppError('Las prácticas deben durar exactamente 60 minutos', 400);
  }
  return PRACTICE_DURATION_MINUTES;
}

// No exponer details de PostgreSQL (pueden contener identificadores).
export function throwPracticeWriteError(error: PostgrestError): never {
  if (error.code === '23P01' ||
      (error.code === '23505' && error.message.includes('practice_slots_instructor_no_overlap'))) {
    throw new AppError('El instructor ya tiene una práctica que se solapa con este intervalo', 409);
  }
  if (error.code === '23514' && error.message.includes('practice_slots_duration_60')) {
    throw new AppError('Las prácticas deben durar exactamente 60 minutos', 400);
  }
  const actionStatus = new Map([['CD404', 404], ['CD403', 403], ['CD409', 409]]).get(error.code);
  if (actionStatus !== undefined) {
    throw new AppError(error.message, actionStatus);
  }
  throw error;
}

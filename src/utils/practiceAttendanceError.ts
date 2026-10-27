import type { PostgrestError } from '@supabase/supabase-js';
import { AppError } from './AppError';
import { throwPracticeWriteError } from './practiceSlotIntegrity';

const errors: Partial<Record<string, [number, string, string?]>> = {
  AT403: [403, 'ATTENDANCE_FORBIDDEN'],
  AT404: [404, 'PRACTICE_NOT_FOUND'],
  AT410: [409, 'ATTENDANCE_WINDOW_CLOSED'],
  AT411: [409, 'ATTENDANCE_SAME_VALUE'],
  AT412: [400, 'INVALID_FIELD', 'motivo'],
  AT413: [409, 'PRACTICE_NOT_COMPLETED'],
  AT414: [409, 'ATTENDANCE_ALREADY_REGISTERED'],
  AT415: [409, 'ATTENDANCE_NOT_REGISTERED'],
  AT417: [409, 'ATTENDANCE_AUDIT_REQUIRED'],
  CD404: [404, 'ENROLLMENT_NOT_FOUND'],
  CD409: [409, 'PRACTICE_CONFLICT'],
};

export function throwAttendanceError(error: PostgrestError): never {
  const mapped = errors[error.code];
  if (mapped) {
    const [status, code, field] = mapped;
    throw new AppError(error.message, status, { code, ...(field ? { field } : {}) });
  }
  throwPracticeWriteError(error);
}

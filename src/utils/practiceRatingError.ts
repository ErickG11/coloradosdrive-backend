import type { PostgrestError } from '@supabase/supabase-js';
import { AppError } from './AppError';

type RatingOperation = 'pending' | 'submit' | 'ranking' | 'detail';

// Mensajes propios: las excepciones SQL pueden contener datos internos.
export function throwPracticeRatingError(error: PostgrestError, operation: RatingOperation): never {
  switch (error.code) {
    case 'RT403':
      throw new AppError('No tienes permiso para consultar o enviar calificaciones', 403, {
        code: 'RATING_FORBIDDEN',
      });
    case 'RT404':
      throw operation === 'detail'
        ? new AppError('Instructor no encontrado', 404, { code: 'INSTRUCTOR_NOT_FOUND' })
        : new AppError('Práctica no encontrada', 404, { code: 'PRACTICE_NOT_FOUND' });
    case 'RT409':
      throw new AppError('Ya calificaste esta práctica', 409, { code: 'RATING_ALREADY_SUBMITTED' });
    case 'RT410':
      throw new AppError('Terminó el plazo para calificar esta práctica', 409, {
        code: 'RATING_WINDOW_CLOSED',
      });
    case 'RT412':
      throw new AppError('Esta práctica no está habilitada para calificar', 409, {
        code: 'RATING_NOT_ELIGIBLE',
      });
    case '22023':
      throw new AppError('Datos de calificación inválidos', 400, { code: 'INVALID_FIELD' });
    case 'CD030':
      throw new AppError('El alumno tiene una eliminación pendiente', 409, {
        code: 'DELETION_PENDING',
      });
    default:
      throw new AppError('Internal server error', 500);
  }
}

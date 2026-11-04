import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import type { PracticeSlotWithNames } from '../models/practiceSlot.model';
import { AppError } from '../utils/AppError';

const ERRORES: Partial<Record<string, [number, string, string]>> = {
  IP403: [403, 'ACCESO_DENEGADO', 'Tu cuenta no puede confirmar la identidad'],
  IP404: [404, 'FRANJA_NO_ENCONTRADA', 'Franja no encontrada'],
  IP409: [409, 'FRANJA_SIN_ALUMNO', 'La franja no tiene un alumno confirmado'],
  IP410: [
    409,
    'FUERA_DE_VENTANA_ASISTENCIA',
    'La confirmación solo se permite en la ventana de asistencia',
  ],
  IP412: [409, 'ALUMNO_SIN_SOLICITUD', 'El alumno no proviene de una solicitud de inscripción'],
};

export interface IdentidadPresencialResultado {
  transicion: boolean;
  confirmadaAt: string;
  certificadoOriginalVisto: boolean;
}

export type FranjaConIdentidad = PracticeSlotWithNames & {
  identidadPresencialPendiente?: true;
  certificadoOriginalRequerido?: boolean;
};

function mapError(error: PostgrestError): AppError {
  const mapped = ERRORES[error.code];
  if (mapped) return new AppError(mapped[2], mapped[0], { code: mapped[1] });
  console.error(JSON.stringify({ event: 'identidad_presencial_failed', code: error.code }));
  return new AppError('No se pudo guardar la confirmación', 500);
}

export class PracticeIdentityService {
  constructor(private readonly db: SupabaseClient<Database>) {}

  async confirmar(
    slotId: string,
    instructorId: string,
    certificadoOriginalVisto: boolean,
  ): Promise<IdentidadPresencialResultado> {
    const { data, error } = await this.db.rpc('confirmar_identidad_presencial', {
      p_slot: slotId,
      p_instructor: instructorId,
      p_certificado_visto: certificadoOriginalVisto,
    });
    if (error) throw mapError(error);
    return data;
  }

  // Marca las franjas con identidad pendiente. Es un complemento de la agenda: si la consulta
  // falla se devuelve la agenda sin marcas (el control no aparece) y se registra un evento sin datos.
  async marcarPendientes(
    instructorId: string,
    slots: PracticeSlotWithNames[],
  ): Promise<FranjaConIdentidad[]> {
    const candidatas = slots
      .filter(
        (s) => s.studentId !== null && (s.status === 'confirmado' || s.status === 'completado'),
      )
      .map((s) => s.id);
    if (candidatas.length === 0) return slots;
    const { data, error } = await this.db.rpc('franjas_identidad_pendiente', {
      p_instructor: instructorId,
      p_slots: candidatas,
    });
    if (error) {
      console.error(
        JSON.stringify({ event: 'identidad_presencial_list_failed', code: error.code }),
      );
      return slots;
    }
    const pendientes = new Map(data.map((r) => [r.slot_id, r.certificado_requerido]));
    return slots.map((s) => {
      const requerido = pendientes.get(s.id);
      return requerido === undefined
        ? s
        : { ...s, identidadPresencialPendiente: true, certificadoOriginalRequerido: requerido };
    });
  }
}

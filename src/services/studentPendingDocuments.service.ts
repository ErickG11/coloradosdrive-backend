import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import { TIPOS_DOCUMENTO } from '../models/solicitud.model';
import { schoolDaysBetween } from '../utils/cohortEligibility';
import { parseFechaCivil } from '../utils/schoolTimezone';
import { calcularEdad } from '../utils/solicitudAge';

export class StudentPendingDocumentsService {
  constructor(private readonly db: SupabaseClient<Database>) {}
  async get(studentId: string, now = new Date()): Promise<{
    documentosPendientes: string[]; fechaLimite: string | null; diasRestantes: number | null; cohortePendiente: boolean;
  }> {
    const enrollments = await this.db.from('enrollments').select('id,cohort_id,status').eq('student_id', studentId).in('status', ['activo', 'pendiente_cohorte']);
    if (enrollments.error) throw enrollments.error;
    if (!enrollments.data.length) return { documentosPendientes: [], fechaLimite: null, diasRestantes: null, cohortePendiente: false };
    const docs = await this.db.from('enrollment_documents').select('enrollment_id,tipo,estado').in('enrollment_id', enrollments.data.map(e => e.id));
    if (docs.error) throw docs.error;
    const user = await this.db.from('users').select('fecha_nacimiento').eq('id', studentId).single();
    if (user.error) throw user.error;
    const exempt = user.data.fecha_nacimiento && calcularEdad(user.data.fecha_nacimiento, now) >= 65;
    const pending = TIPOS_DOCUMENTO.filter(tipo => !(exempt && tipo === 'papeleta_votacion') && enrollments.data.some(e => {
      const doc = docs.data.find(d => d.enrollment_id === e.id && d.tipo === tipo);
      return !doc || doc.estado === 'pendiente';
    }));
    const ids = enrollments.data.map(e => e.cohort_id).filter((id): id is string => Boolean(id));
    let fechaLimite: string | null = null;
    if (ids.length) {
      const cohorts = await this.db.from('cohorts').select('fecha_fin_matricula').in('id', ids).order('fecha_fin_matricula');
      if (cohorts.error) throw cohorts.error;
      fechaLimite = cohorts.data[0]?.fecha_fin_matricula ?? null;
    }
    return { documentosPendientes: pending, fechaLimite,
      diasRestantes: fechaLimite ? schoolDaysBetween(now, parseFechaCivil(fechaLimite).toJSDate()) : null,
      cohortePendiente: enrollments.data.some(e => e.status === 'pendiente_cohorte'),
    };
  }
}

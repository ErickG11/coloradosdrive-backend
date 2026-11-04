import { DateTime } from 'luxon';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import { DOCUMENTOS_FISICOS, EDAD_EXENCION_VOTACION } from '../config/enrollmentCatalog';
import { schoolDaysBetween } from '../utils/cohortEligibility';
import { parseFechaCivil } from '../utils/schoolTimezone';
import { calcularEdad } from '../utils/solicitudAge';
import { AppError } from '../utils/AppError';
import { logSafeError } from '../utils/safeLog';
import { MENSAJE_INSCRIPCION_INCOMPLETA } from './studentEnrollmentAccess';

export const MOTIVO_REQUISITOS_PENDIENTES =
  'La escuela aún está verificando tu identidad y tus estudios. Te avisaremos cuando estén listos.';
type Db = SupabaseClient<Database>;
type TipoFisico = (typeof DOCUMENTOS_FISICOS)[number]['tipo'];
type Etapa = Database['public']['Tables']['enrollments']['Row']['etapa_inscripcion'];
export interface DocumentoFisicoEstado {
  tipo: TipoFisico;
  label: string;
  estado: 'pendiente' | 'entregado' | 'exento';
  obligatorio: boolean;
  exento: boolean;
  destacado: boolean;
}
export interface EstadoInscripcionAlumno {
  enrollmentId: string | null;
  origen: 'manual' | 'solicitud' | null;
  etapa: Etapa | 'sin_matricula';
  accesoCompleto: boolean;
  pasos: { documentos: boolean; horario: boolean; pago: boolean };
  serverNow: string;
  reserva: {
    expiraAt: string;
    serverNow: string;
    cohorte: { id: string; nombre: string } | null;
  } | null;
  verificaciones: {
    identidad: boolean;
    estudios: boolean;
    tipoSangreDeclarado: string | null;
    nivelEstudios: string | null;
  };
  requisitosVerificados: boolean;
  puedePagar: boolean;
  motivoBloqueo: string | null;
  cohorte: { id: string; nombre: string } | null;
  documentosFisicos: DocumentoFisicoEstado[];
  fechaLimite: string | null;
  diasRestantes: number | null;
  identidadPresencial: { confirmada: boolean; confirmadaAt: string | null } | null;
}
const DEFINICIONES: readonly {
  tipo: TipoFisico;
  label: string;
  obligatorio: boolean;
  bloqueaPago: boolean;
}[] = DOCUMENTOS_FISICOS;
const ESTADOS_VIGENTES = ['activo', 'pendiente_cohorte'] as const;
interface EnrollmentRow {
  id: string;
  course_id: string;
  cohort_id: string | null;
  origen: 'manual' | 'solicitud';
  etapa_inscripcion: Etapa;
  reserva_expira_at: string | null;
  requisitos_verificados_at: string | null;
  identidad_presencial_at: string | null;
  cohorts: { nombre: string; fecha_fin_matricula: string } | null;
}
function unavailable(error: unknown): never {
  logSafeError('student_enrollment_status_failed', error);
  throw new AppError('No se pudo consultar tu inscripción. Intenta nuevamente.', 503, {
    code: 'INSCRIPCION_NO_DISPONIBLE',
  });
}
export async function tieneRequisitosPendientes(db: Db, studentId: string): Promise<boolean> {
  const { data, error } = await db
    .from('enrollments')
    .select('id')
    .eq('student_id', studentId)
    .eq('origen', 'solicitud')
    .is('requisitos_verificados_at', null)
    .in('status', ESTADOS_VIGENTES)
    .limit(1);
  if (error) unavailable(error);
  return data.length > 0;
}
export class StudentEnrollmentStatusService {
  constructor(private readonly db: Db) {}
  async get(studentId: string, now = new Date()): Promise<EstadoInscripcionAlumno> {
    const enrollments = await this.db
      .from('enrollments')
      .select(
        'id,course_id,cohort_id,origen,etapa_inscripcion,reserva_expira_at,requisitos_verificados_at,identidad_presencial_at,cohorts!enrollments_cohort_id_fkey(nombre,fecha_fin_matricula)',
      )
      .eq('student_id', studentId)
      .in('status', ESTADOS_VIGENTES)
      .order('created_at', { ascending: false })
      .order('id')
      .overrideTypes<EnrollmentRow[], { merge: false }>();
    if (enrollments.error) unavailable(enrollments.error);
    const rows = enrollments.data;
    const incompleta = rows.some(
      (r) => r.origen === 'solicitud' && r.etapa_inscripcion !== 'activa',
    );
    const principal =
      rows.find((r) => r.origen === 'solicitud' && r.etapa_inscripcion !== 'activa') ??
      rows.find((r) => r.origen === 'solicitud') ??
      rows.at(0);
    const serverNow = now.toISOString();
    if (!principal)
      return {
        enrollmentId: null,
        origen: null,
        etapa: 'sin_matricula',
        accesoCompleto: true,
        pasos: { documentos: false, horario: false, pago: false },
        serverNow,
        reserva: null,
        verificaciones: {
          identidad: false,
          estudios: false,
          tipoSangreDeclarado: null,
          nivelEstudios: null,
        },
        requisitosVerificados: true,
        puedePagar: false,
        motivoBloqueo: 'Todavía no tienes una matrícula activa.',
        cohorte: null,
        documentosFisicos: [],
        fechaLimite: null,
        diasRestantes: null,
        identidadPresencial: null,
      };
    const [docs, user, request, practice] = await Promise.all([
      this.db.from('enrollment_documents').select('tipo,estado').eq('enrollment_id', principal.id),
      this.db.from('users').select('fecha_nacimiento,tipo_sangre').eq('id', studentId).single(),
      principal.origen === 'solicitud'
        ? this.db
            .from('solicitudes_inscripcion')
            .select('tipo_sangre,nivel_estudios')
            .eq('student_id', studentId)
            .eq('course_id', principal.course_id)
            .eq('estado', 'aprobada')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      principal.cohort_id && principal.etapa_inscripcion === 'activa'
        ? this.db
            .from('practice_slots')
            .select('scheduled_at')
            .eq('student_id', studentId)
            .eq('cohort_id', principal.cohort_id)
            .in('status', ['asignado', 'confirmado', 'completado'])
            .order('scheduled_at')
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (docs.error) unavailable(docs.error);
    if (user.error) unavailable(user.error);
    if (request.error) unavailable(request.error);
    if (practice.error) unavailable(practice.error);
    const sangre = request.data?.tipo_sangre ?? user.data.tipo_sangre;
    const exentoVotacion = Boolean(
      user.data.fecha_nacimiento &&
      calcularEdad(user.data.fecha_nacimiento, now) >= EDAD_EXENCION_VOTACION,
    );
    const documentosFisicos = DEFINICIONES.map((def): DocumentoFisicoEstado => {
      const fila = docs.data.find((d) => d.tipo === def.tipo);
      const exento =
        (def.tipo === 'papeleta_votacion' && exentoVotacion) || fila?.estado === 'no_aplica';
      return {
        tipo: def.tipo,
        label: def.label,
        estado: exento ? 'exento' : fila?.estado === 'entregado' ? 'entregado' : 'pendiente',
        obligatorio: def.obligatorio && !exento,
        exento,
        destacado: def.tipo === 'tipo_sangre' && sangre === 'no_sabe',
      };
    });
    const requisitosVerificados =
      principal.origen === 'manual' || principal.requisitos_verificados_at !== null;
    const bloqueaPorDocumento = DEFINICIONES.some(
      (def) =>
        def.bloqueaPago &&
        documentosFisicos.some((d) => d.tipo === def.tipo && d.estado === 'pendiente'),
    );
    const reservaVigente =
      principal.etapa_inscripcion === 'reservado' &&
      principal.reserva_expira_at !== null &&
      new Date(principal.reserva_expira_at) > now;
    const etapa =
      principal.etapa_inscripcion === 'reservado' && !reservaVigente
        ? 'por_agendar'
        : principal.etapa_inscripcion;
    const cohorte =
      principal.cohort_id && principal.cohorts
        ? { id: principal.cohort_id, nombre: principal.cohorts.nombre }
        : null;
    // R8 para solicitudes; las matrículas manuales mantienen su plazo histórico.
    const fechaLimite =
      principal.origen === 'solicitud'
        ? practice.data
          ? DateTime.fromISO(practice.data.scheduled_at, { zone: 'America/Guayaquil' }).toISODate()
          : null
        : (principal.cohorts?.fecha_fin_matricula ?? null);
    const puedePagar =
      requisitosVerificados &&
      !bloqueaPorDocumento &&
      (principal.origen === 'manual' || reservaVigente);
    const motivoBloqueo = !requisitosVerificados
      ? MOTIVO_REQUISITOS_PENDIENTES
      : bloqueaPorDocumento
        ? 'Tienes documentos físicos pendientes que bloquean el pago.'
        : incompleta
          ? MENSAJE_INSCRIPCION_INCOMPLETA
          : null;
    return {
      enrollmentId: principal.id,
      origen: principal.origen,
      etapa,
      accesoCompleto: !incompleta,
      pasos: {
        documentos: requisitosVerificados,
        horario: etapa === 'activa' || reservaVigente,
        pago: etapa === 'activa',
      },
      serverNow,
      reserva:
        reservaVigente && principal.reserva_expira_at
          ? { expiraAt: principal.reserva_expira_at, serverNow, cohorte }
          : null,
      verificaciones: {
        identidad: requisitosVerificados,
        estudios: requisitosVerificados,
        tipoSangreDeclarado: sangre,
        nivelEstudios: request.data?.nivel_estudios ?? null,
      },
      requisitosVerificados,
      puedePagar,
      motivoBloqueo,
      cohorte: etapa === 'por_agendar' ? null : cohorte,
      documentosFisicos,
      fechaLimite,
      diasRestantes: fechaLimite
        ? schoolDaysBetween(now, parseFechaCivil(fechaLimite).toJSDate())
        : null,
      identidadPresencial:
        principal.origen === 'solicitud'
          ? {
              confirmada: principal.identidad_presencial_at !== null,
              confirmadaAt: principal.identidad_presencial_at,
            }
          : null,
    };
  }
}

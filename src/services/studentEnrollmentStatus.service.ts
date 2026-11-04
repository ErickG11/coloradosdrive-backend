import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import { DOCUMENTOS_FISICOS, EDAD_EXENCION_VOTACION } from '../config/enrollmentCatalog';
import { schoolDaysBetween } from '../utils/cohortEligibility';
import { parseFechaCivil } from '../utils/schoolTimezone';
import { calcularEdad } from '../utils/solicitudAge';

export const MOTIVO_REQUISITOS_PENDIENTES =
  'La escuela aún está verificando tu identidad y tus estudios. Te avisaremos cuando estén listos.';
const MOTIVO_SIN_MATRICULA = 'Todavía no tienes una matrícula activa.';
const MOTIVO_DOCUMENTO_PENDIENTE = 'Tienes documentos físicos pendientes que bloquean el pago.';

type Db = SupabaseClient<Database>;
type TipoFisico = (typeof DOCUMENTOS_FISICOS)[number]['tipo'];

export interface DocumentoFisicoEstado {
  tipo: TipoFisico;
  label: string;
  estado: 'pendiente' | 'entregado' | 'exento';
  obligatorio: boolean;
  exento: boolean;
  destacado: boolean;
}

export interface EstadoInscripcionAlumno {
  requisitosVerificados: boolean;
  puedePagar: boolean;
  motivoBloqueo: string | null;
  cohorte: { id: string; nombre: string } | null;
  documentosFisicos: DocumentoFisicoEstado[];
  fechaLimite: string | null;
  diasRestantes: number | null;
  identidadPresencial: { confirmada: boolean; confirmadaAt: string | null } | null;
}

// Ampliado a boolean para que cambiar la configuración del catálogo no requiera tocar esta lógica.
const DEFINICIONES: readonly {
  tipo: TipoFisico;
  label: string;
  obligatorio: boolean;
  bloqueaPago: boolean;
}[] = DOCUMENTOS_FISICOS;

const ESTADOS_VIGENTES = ['activo', 'pendiente_cohorte'] as const;

interface EnrollmentRow {
  id: string;
  cohort_id: string | null;
  origen: 'manual' | 'solicitud';
  requisitos_verificados_at: string | null;
  identidad_presencial_at: string | null;
  created_at: string;
  cohorts: { nombre: string; fecha_fin_matricula: string } | null;
}

// Una matrícula originada en una solicitud no puede reclamar ni cambiar cupos hasta que la
// escuela verifique identidad y estudios (requisitos_verificados_at). Las manuales no se ven afectadas.
export async function tieneRequisitosPendientes(db: Db, studentId: string): Promise<boolean> {
  const { data, error } = await db
    .from('enrollments')
    .select('id')
    .eq('student_id', studentId)
    .eq('origen', 'solicitud')
    .is('requisitos_verificados_at', null)
    .in('status', ESTADOS_VIGENTES)
    .limit(1);
  if (error) throw error;
  return data.length > 0;
}

export class StudentEnrollmentStatusService {
  constructor(private readonly db: Db) {}

  async get(studentId: string, now = new Date()): Promise<EstadoInscripcionAlumno> {
    const enrollments = await this.db
      .from('enrollments')
      .select(
        'id,cohort_id,origen,requisitos_verificados_at,identidad_presencial_at,created_at,cohorts!enrollments_cohort_id_fkey(nombre,fecha_fin_matricula)',
      )
      .eq('student_id', studentId)
      .in('status', ESTADOS_VIGENTES)
      .order('created_at', { ascending: false })
      .overrideTypes<EnrollmentRow[], { merge: false }>();
    if (enrollments.error) throw enrollments.error;
    const rows = enrollments.data;
    // Se informa sobre la matrícula de solicitud si existe; si no, sobre la más reciente.
    const principal = rows.find((r) => r.origen === 'solicitud') ?? rows.at(0);
    if (!principal) {
      return {
        requisitosVerificados: true,
        puedePagar: false,
        motivoBloqueo: MOTIVO_SIN_MATRICULA,
        cohorte: null,
        documentosFisicos: [],
        fechaLimite: null,
        diasRestantes: null,
        identidadPresencial: null,
      };
    }

    const [docs, user] = await Promise.all([
      this.db.from('enrollment_documents').select('tipo,estado').eq('enrollment_id', principal.id),
      this.db.from('users').select('fecha_nacimiento,tipo_sangre').eq('id', studentId).single(),
    ]);
    if (docs.error) throw docs.error;
    if (user.error) throw user.error;

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
        destacado: def.tipo === 'tipo_sangre' && user.data.tipo_sangre === 'no_sabe',
      };
    });

    const requisitosVerificados = !(
      principal.origen === 'solicitud' && principal.requisitos_verificados_at === null
    );
    const bloqueaPorDocumento = DEFINICIONES.some(
      (def) =>
        def.bloqueaPago &&
        documentosFisicos.some((d) => d.tipo === def.tipo && d.estado === 'pendiente'),
    );
    const fechaLimite = principal.cohorts?.fecha_fin_matricula ?? null;
    let motivoBloqueo: string | null = null;
    if (!requisitosVerificados) motivoBloqueo = MOTIVO_REQUISITOS_PENDIENTES;
    else if (bloqueaPorDocumento) motivoBloqueo = MOTIVO_DOCUMENTO_PENDIENTE;
    return {
      requisitosVerificados,
      puedePagar: requisitosVerificados && !bloqueaPorDocumento,
      motivoBloqueo,
      cohorte:
        principal.cohort_id && principal.cohorts
          ? { id: principal.cohort_id, nombre: principal.cohorts.nombre }
          : null,
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
